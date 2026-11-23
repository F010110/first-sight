"""One bounded local static capture with OS-disabled game input and a kill-on-close Job.

Never sends keyboard/mouse events. Refuses any existing GMod instance. Stops only
its own process tree on timeout/cursor confinement/low space/STOP file. No downloads.
"""
import argparse
import csv
import ctypes
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

def game_pids():
    rows = csv.reader(subprocess.check_output(['tasklist.exe', '/FO', 'CSV', '/NH'], text=True, errors='replace').splitlines())
    return [int(row[1]) for row in rows if len(row) > 1 and row[0].lower() in ('gmod.exe', 'gmod_win64.exe')]

def run(root, output, seconds, mode='static', map_name='gm_construct'):
    if map_name not in ('gm_construct', 'rp_unioncity_day'): raise ValueError('Unapproved map')
    if mode not in ('static', 'motion-video', 'download-unioncity', 'render-route', 'render-route-v2'): raise ValueError('Unknown capture mode')
    if os.name != 'nt': raise RuntimeError('Windows only')
    if game_pids(): raise RuntimeError('Existing GMod instance detected; refusing another launch')
    exe = root / 'gmod_win64.exe'
    if not exe.is_file(): raise FileNotFoundError(exe)
    if shutil.disk_usage(root).free < 20_000_000_000: raise RuntimeError('20GB reserve not met')
    output.mkdir(parents=True, exist_ok=False)
    kernel, user = ctypes.WinDLL('kernel32', use_last_error=True), ctypes.WinDLL('user32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [W.LPVOID, W.BOOL, W.LPCWSTR]; kernel.CreateMutexW.restype = W.HANDLE
    kernel.CreateJobObjectW.argtypes = [W.LPVOID, W.LPCWSTR]; kernel.CreateJobObjectW.restype = W.HANDLE
    kernel.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, W.LPVOID, W.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
    kernel.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
    kernel.CloseHandle.argtypes = [W.HANDLE]
    mutex = kernel.CreateMutexW(None, False, 'Local\\FirstSightGmodSafePilot')
    if not mutex or ctypes.get_last_error() == 183:
        if mutex: kernel.CloseHandle(mutex)
        raise RuntimeError('Another safe pilot owns the automation mutex')
    class Limits(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64), ('flags', W.DWORD),
                    ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t), ('active', W.DWORD),
                    ('affinity', ctypes.c_size_t), ('priority', W.DWORD), ('scheduling', W.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes']]
    class Extended(ctypes.Structure):
        _fields_ = [('basic', Limits), ('io', IO), ('proc_mem', ctypes.c_size_t), ('job_mem', ctypes.c_size_t),
                    ('peak_proc', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
    job = kernel.CreateJobObjectW(None, None)
    limits = Extended(); limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        if job: kernel.CloseHandle(job)
        kernel.CloseHandle(mutex)
        raise ctypes.WinError(ctypes.get_last_error())
    data = root/'garrysmod/data'
    request = data/'first_sight_smoke_request.json'
    proc, reason, events = None, 'not-launched', []
    owned_request = None
    baseline = set((data/'first_sight').glob('*/summary.json'))
    @ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    def disable_window(hwnd, _):
        pid = W.DWORD(); user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if proc and pid.value == proc.pid:
            user.EnableWindow(hwnd, False)  # Does not disable the user's other applications.
        return True
    user.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM), W.LPARAM]
    result = {'pid': None, 'input_events_sent': 0, 'window_input_disabled': True,
              'runtime_cursor_freedom_certified': False, 'events': events}
    hotkey_registered = False
    try:
        hotkey_registered = bool(user.RegisterHotKey(None, 0x4653, 0x4003, 0x7B))  # Ctrl+Alt+F12, no repeat
        if not hotkey_registered: raise RuntimeError('Emergency Ctrl+Alt+F12 hotkey unavailable; refusing launch')
        if request.exists():
            raw = request.read_bytes()
            previous = json.loads(raw)
            if previous.get('mode') not in ('static', 'motion-video', 'download-unioncity') or time.time()-previous.get('created_unix_s', time.time()) < 120:
                raise RuntimeError('Active/unfamiliar request preserved; do not double-start')
            (output/'expired-request.json').write_bytes(raw)
            request.unlink()  # Only the known expired one-shot request, not data.
        owned_request = json.dumps({'mode': mode, 'created_unix_s': time.time()})
        with request.open('x', encoding='utf8') as dest: dest.write(owned_request)
        env = {k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','COMSPEC','SYSTEMDRIVE','HOMEDRIVE','HOMEPATH'}}
        command = [str(exe), '-steam', '-windowed', '-w', '1600', '-h', '900', '-novid', '-condebug',
                   '+cl_mouseenable', '0', '+m_rawinput', '0', '+fps_max', '60', '+map', map_name]
        result['command'] = command
        startup = subprocess.STARTUPINFO(); startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW; startup.wShowWindow = 4
        proc = subprocess.Popen(command, cwd=root, env=env, startupinfo=startup)
        result['pid'] = proc.pid
        if not kernel.AssignProcessToJobObject(job, W.HANDLE(int(proc._handle))):
            proc.kill(); proc.wait(timeout=5)
            raise ctypes.WinError(ctypes.get_last_error())
        deadline = time.monotonic()+seconds
        reason = 'timeout'
        while proc.poll() is None and time.monotonic() < deadline:
            message = W.MSG()
            if user.PeekMessageW(ctypes.byref(message), None, 0x0312, 0x0312, 1):
                if message.wParam == 0x4653: reason = 'emergency-hotkey'; break
            user.EnumWindows(disable_window, 0)
            rect = W.RECT(); user.GetClipCursor(ctypes.byref(rect))
            screen = (user.GetSystemMetrics(76), user.GetSystemMetrics(77), user.GetSystemMetrics(78), user.GetSystemMetrics(79))
            if (rect.left, rect.top, rect.right, rect.bottom) != (screen[0], screen[1], screen[0]+screen[2], screen[1]+screen[3]):
                events.append({'cursor_clip': [rect.left,rect.top,rect.right,rect.bottom]})
                reason = 'cursor-confined-abort'; break
            if (output/'STOP').exists(): reason = 'external-stop-file'; break
            if shutil.disk_usage(root).free < 20_000_000_000: reason = 'low-space'; break
            complete = set((data/'first_sight').glob('*/summary.json'))-baseline
            if complete:
                result['episode_summaries'] = [str(p) for p in complete]
                reason = 'capture-finished'; break
            time.sleep(.1)
        if proc.poll() is not None: reason = 'game-exited'
    finally:
        if proc and proc.poll() is None:
            kernel.TerminateJobObject(job, 0)
            proc.wait(timeout=10)
        kernel.CloseHandle(job); kernel.CloseHandle(mutex)
        if hotkey_registered: user.UnregisterHotKey(None, 0x4653)
        user.ClipCursor(None)
        if owned_request is not None and request.exists() and request.read_text(encoding='utf8') == owned_request:
            request.unlink()
        result.update(reason=reason, exit_code=proc.poll() if proc else None,
                      remaining_game_pids=game_pids(), model_calls=0)
        (output/'result.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seconds', type=int, choices=range(10, 601), default=45)
    parser.add_argument('--mode', choices=['static', 'motion-video','download-unioncity','render-route','render-route-v2'], default='static')
    parser.add_argument('--map', dest='map_name', choices=['gm_construct','rp_unioncity_day'], default='gm_construct')
    args = parser.parse_args()
    run(args.game_root.resolve(), args.output, args.seconds, args.mode, args.map_name)

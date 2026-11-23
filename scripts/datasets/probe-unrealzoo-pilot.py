"""Bounded credential-free local probe; no dependencies, models or installers."""
import argparse
import configparser
import json
import os
from pathlib import Path
import socket
import shutil
import struct
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'datasets/controllable-scenes/unrealzoo-ue4-example-v1/runtime/UE4_ExampleScene_Win_0422_25'
OUT = ROOT / 'run/unrealzoo-ue4-runtime-probe-v1'

def main(output=OUT):
    global OUT
    OUT = output
    if any(shutil.disk_usage(drive).free < 20_000_000_000 for drive in ['C:\\', 'D:\\']):
        raise RuntimeError('20GB free-space reserve not met')
    OUT.mkdir(exist_ok=False)
    port = 19097
    with socket.socket() as check:
        check.bind(('127.0.0.1', port))
    exe = BASE / 'UE4_ExampleScene/Binaries/Win64/UE4_ExampleScene.exe'
    ini = exe.parent / 'unrealcv.ini'
    expected_ini = f'[UnrealCV.Core]\nPort={port}\nWidth=640\nHeight=480\n'
    if ini.exists():
        config = configparser.ConfigParser()
        config.read(ini, encoding='ascii')
        if any(config.get('UnrealCV.Core', key, fallback='') != value for key, value in [('Port', str(port)), ('Width', '640'), ('Height', '480')]):
            raise FileExistsError('Preserving unfamiliar UnrealCV configuration')
        shutil.copy2(ini, OUT / 'unrealcv-before.ini')
    else:
        ini.write_text(expected_ini, encoding='ascii')
    env = {k: v for k, v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','COMSPEC','SYSTEMDRIVE','HOMEDRIVE','HOMEPATH'}}
    command = [str(exe), 'SuburbNeighborhood_Day', '-windowed', '-ResX=640', '-ResY=480', '-nosound', '-unattended', '-log', f'-abslog={OUT / "engine.log"}']
    records = []
    proc = None
    client = None
    def receive():
        def exact(n):
            data = b''
            while len(data) < n:
                chunk = client.recv(n-len(data))
                if not chunk:
                    raise ConnectionError('Closed socket')
                data += chunk
            return data
        magic, size = struct.unpack('<II', exact(8))
        if magic != 0x9E2B83C1 or size > 16_000_000:
            raise ValueError('Invalid protocol frame')
        return exact(size)
    def request(cmd):
        index = len(records)
        body = f'{index}:{cmd}'.encode()
        client.sendall(struct.pack('<II', 0x9E2B83C1, len(body))+body)
        result = receive()
        prefix = f'{index}:'.encode()
        if not result.startswith(prefix):
            raise ValueError('Unexpected response id')
        result = result[len(prefix):]
        if result.startswith(b'\x89PNG'):
            name = f'capture-{index}.png'
            (OUT/name).write_bytes(result)
            records.append({'command': cmd, 'image': name, 'bytes': len(result)})
            return name
        text = result.decode('utf8', errors='replace')
        records.append({'command': cmd, 'response': text})
        return text
    try:
        proc = subprocess.Popen(command, cwd=exe.parent, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic()+90
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f'Executable exited: {proc.returncode}')
            try:
                client = socket.create_connection(('127.0.0.1', port), timeout=2)
                client.settimeout(15)
                break
            except OSError:
                time.sleep(1)
        if client is None:
            raise TimeoutError('No local UnrealCV server within 90 seconds')
        records.append({'greeting': receive().decode('utf8', errors='replace')})
        for cmd in ['vget /unrealcv/status', 'vget /unrealcv/commands', 'vget /cameras', 'vget /camera/0/pose', 'vget /camera/0/lit png', 'vget /objects']:
            request(cmd)
        for cmd in ['vget /camera/0/location', 'vget /camera/0/rotation', 'vget /camera/0/fov', 'vget /action/game/is_paused', 'vset /action/game/pause', 'vget /camera/1/location', 'vget /camera/1/rotation', 'vget /object/SM_Bed_queen_395/location', 'vget /object/SM_Basement_table_198/location']:
            request(cmd)
        location = request('vget /camera/0/location')
        rotation = request('vget /camera/0/rotation')
        try:
            xyz = [float(v) for v in location.split()]
            angles = [float(v) for v in rotation.split()]
            if len(xyz) == 3 and len(angles) == 3:
                request('vset /camera/0/location ' + ' '.join(str(v) for v in xyz))
                for yaw in [angles[1], angles[1]-90, angles[1]+90]:
                    request(f'vset /camera/0/rotation {angles[0]} {yaw} {angles[2]}')
                    request('vget /camera/0/rotation')
                    request('vget /camera/0/lit png')
                request('vset /camera/0/rotation '+rotation)
        except ValueError:
            pass
        request('vget /action/game/is_paused')
        for cam, yaw in [(1, 0), (2, -90), (3, 90)]:
            for cmd in [f'vset /camera/{cam}/location 0 0 170', f'vset /camera/{cam}/rotation 0 {yaw} 0', f'vget /camera/{cam}/location', f'vget /camera/{cam}/rotation', f'vget /camera/{cam}/lit png']:
                request(cmd)
        request('vget /action/game/is_paused')
        # Diagnostic teleport only: does NOT prove walkable entry or connectivity.
        for x, y, z in [(3110, 1513, 530), (3110, 1313, 530), (3461, 1025, -70)]:
            request(f'vset /camera/1/location {x} {y} {z}')
            for yaw in [0, 90, 180, -90]:
                request(f'vset /camera/1/rotation 0 {yaw} 0')
                request('vget /camera/1/lit png')
        request('vset /action/game/resume')
    except Exception as error:
        records.append({'error': str(error)})
    finally:
        if client:
            client.close()
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        (OUT/'probe.json').write_text(json.dumps({'command': command, 'records': records, 'credentialsInherited': False, 'modelCalls': 0, 'finalDatasetAccepted': False}, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(records, ensure_ascii=False)[:3000])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args()
    main(args.output)

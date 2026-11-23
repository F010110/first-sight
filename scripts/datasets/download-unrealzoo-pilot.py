"""Explicitly authorized, bounded UnrealZoo candidate download/extraction.

No editor/dependency installation, model calls, or executable launch. Retains
failed transfers, resumes once, checks pinned SHA256 and validates ZIP paths.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

NAME = 'UE4_ExampleScene_Win_0422_25.zip'
REV = '1efa773fd840e874d04cc75e51d8470e61ee2ed5'
SIZE = 2_835_320_036
SHA256 = 'b07d9ef336e4a1c546e0e2df36242406d4b2cedc27e932d26f9d942a16d9a0e1'
URL = f'https://modelscope.cn/datasets/UnrealZoo/UnrealZoo-UE4/resolve/{REV}/{NAME}'

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def safe_members(infos, cap=12_000_000_000):
    if len(infos) > 50000 or sum(i.file_size for i in infos) > cap:
        raise ValueError('Archive exceeds authorized extraction budget')
    names = set()
    for info in infos:
        p = PurePosixPath(info.filename.replace('\\', '/'))
        if p.is_absolute() or '..' in p.parts or any(':' in part for part in p.parts) or stat.S_ISLNK(info.external_attr >> 16):
            raise ValueError('Unsafe ZIP member')
        key = str(p).lower()
        if key in names:
            raise ValueError('Duplicate/case-colliding archive member')
        names.add(key)
    return infos

def run(output):
    output.mkdir(parents=True, exist_ok=False)
    save(output / 'plan.json', {'purpose': 'candidate controllability/indoor-outdoor/three-camera acceptance, NOT final dataset', 'sourceURL': URL, 'revision': REV, 'bytes': SIZE, 'sha256': SHA256, 'downloadCapBytes': 3_000_000_000, 'extractCapBytes': 12_000_000_000, 'maxAttempts': 2, 'userAuthorized': True, 'editorInstall': False, 'modelCalls': 0, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    part = output / (NAME + '.part')
    attempts = []
    for attempt in range(1, 3):
        before = part.stat().st_size if part.exists() else 0
        command = ['curl.exe', '--fail', '--location', '--http1.1', '--no-progress-meter', '--connect-timeout', '20', '--max-time', '1200', '--speed-limit', '1024', '--speed-time', '45', '--max-filesize', str(SIZE), '--continue-at', str(before), '--output', str(part), URL]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=1210)
            code, error = result.returncode, result.stderr[-2000:]
        except subprocess.TimeoutExpired:
            code, error = -1, 'Bounded download timeout'
        after = part.stat().st_size if part.exists() else 0
        attempts.append({'attempt': attempt, 'resumeFrom': before, 'retainedBytes': after, 'code': code, 'error': error})
        save(output / 'download-attempts.json', attempts)
        if after > SIZE or after < before:
            raise ValueError('Unexpected resumed-file size; preserved, not restarted')
        if code == 0 and after == SIZE:
            break
        print('bounded-download-attempt', attempt, 'curl-code', code, 'retainedBytes', after, flush=True)
    if not part.exists() or part.stat().st_size != SIZE:
        raise ValueError('Bounded transfer incomplete; no executable launched')
    h = hashlib.sha256()
    with part.open('rb') as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    if h.hexdigest() != SHA256:
        raise ValueError('Pinned SHA256 mismatch; no extraction or execution')
    archive = output / NAME
    part.rename(archive)
    with zipfile.ZipFile(archive) as z:
        infos = safe_members(z.infolist())
        save(output / 'archive-index.json', [{'path': i.filename, 'bytes': i.file_size} for i in infos])
        runtime = output / 'runtime'
        runtime.mkdir()
        z.extractall(runtime)
    save(output / 'download-complete.json', {'bytes': SIZE, 'sha256': SHA256, 'extractedBytes': sum(i.file_size for i in infos), 'members': len(infos), 'executables': [str(p.relative_to(output)) for p in sorted(runtime.rglob('*.exe'))], 'installedEditor': False, 'launchedExecutable': False, 'modelCalls': 0})
    print((output / 'download-complete.json').read_text(), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--confirm-download', action='store_true')
    args = parser.parse_args()
    if not args.confirm_download:
        parser.error('Explicit --confirm-download required')
    run(args.output)

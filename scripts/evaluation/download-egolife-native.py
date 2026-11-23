"""Download/import ONLY the frozen EgoLife pilot files; keep verified work.

No system proxy changes, no TLS bypass. At most two attempts per missing file in
this continuation, serial requests, and a persisted 1.8GB total byte budget.
Without --download this only verifies inventory and exports browser links.
"""
import argparse
import csv
import datetime
import hashlib
import html
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CAP = 1_800_000_000

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def verified(path, row):
    if not path.is_file() or path.stat().st_size != row['size']:
        return False
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest() == row['lfs']['oid']

def url_for(plan, row):
    return f"https://huggingface.co/datasets/lmms-lab/EgoLife/resolve/{plan['revision']}/{row['path']}?download=true"

def export_links(root, plan):
    entries = []
    for index, row in enumerate(plan['files']):
        entries.append({'index': index, 'localName': f'{index:04d}.mp4', 'sourceName': Path(row['path']).name, 'bytes': row['size'], 'sha256': row['lfs']['oid'], 'verified': verified(root / 'clips' / f'{index:04d}.mp4', row), 'url': url_for(plan, row)})
    missing = [r for r in entries if not r['verified']]
    save(root / 'browser-download-links.json', {'missing': missing, 'all': entries})
    with (root / 'browser-download-links.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=['index', 'localName', 'sourceName', 'bytes', 'sha256', 'verified', 'url'])
        writer.writeheader()
        writer.writerows(missing)
    (root / 'browser-download-links.html').write_text('<!doctype html><meta charset="utf-8"><title>EgoLife pilot missing clips</title><h1>EgoLife先导：缺失片段</h1><p>只下载下面列出的文件到一个文件夹，保留原文件名；用脚本 --import-dir 导入并校验。不要下载整个数据集。</p><p>已校验 ' + str(len(entries) - len(missing)) + '/136；缺失 ' + str(len(missing)) + '。</p><ol>' + ''.join('<li><a href="' + html.escape(r['url'], quote=True) + '">' + html.escape(r['sourceName']) + '</a> (' + str(r['bytes']) + ' bytes → ' + r['localName'] + ')</li>' for r in missing) + '</ol>', encoding='utf8')
    return entries

def execute(root, download=False, import_dir=None):
    plan = json.loads((root / 'plan.json').read_text(encoding='utf8'))
    if len(plan['files']) != 136 or plan['capBytes'] != CAP or sum(r['size'] for r in plan['files']) != 1_744_496_614:
        raise ValueError('Frozen download scope changed')
    if import_dir:
        for index, row in enumerate(plan['files']):
            target = root / 'clips' / f'{index:04d}.mp4'
            if verified(target, row):
                continue
            if target.exists():
                raise ValueError('Existing invalid file retained, not overwritten: ' + str(target))
            candidates = [import_dir / Path(row['path']).name, import_dir / target.name]
            source = next((p for p in candidates if verified(p, row)), None)
            if source:
                with source.open('rb') as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
                print('imported', index, flush=True)
    entries = export_links(root, plan)
    if not download:
        print(json.dumps({'verified': sum(r['verified'] for r in entries), 'missing': sum(not r['verified'] for r in entries), 'browserLinks': str((root / 'browser-download-links.html').resolve())}))
        return
    recovery = root / 'serial-proxy-recovery'
    recovery.mkdir(exist_ok=True)
    ledger_path = recovery / 'ledger.json'
    plan_hash = hashlib.sha256((root / 'plan.json').read_bytes()).hexdigest()
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text(encoding='utf8'))
        if ledger['planSha256'] != plan_hash:
            raise ValueError('Download ledger/source mismatch')
    else:
        # Previous failed transfers left no partial files in this input; count all
        # existing clip bytes conservatively rather than starting the budget at 0.
        baseline = sum(p.stat().st_size for p in (root / 'clips').glob('*.mp4'))
        ledger = {'planSha256': plan_hash, 'initialRetainedBytes': baseline, 'totalBytesIncludingFailedAttempts': baseline, 'capBytes': CAP, 'attempts': [], 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'authorization': 'User explicitly requested continuation and proxy diagnosis after two interrupted transports'}
        save(ledger_path, ledger)
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    for index, row in enumerate(plan['files']):
        target = root / 'clips' / f'{index:04d}.mp4'
        if verified(target, row):
            continue
        if target.exists():
            raise ValueError('Existing invalid file retained, not overwritten')
        previous = sum(a['index'] == index for a in ledger['attempts'])
        for attempt in range(previous + 1, 3):
            if ledger['totalBytesIncludingFailedAttempts'] + row['size'] > CAP:
                raise ValueError('Cumulative byte cap exhausted; browser links preserved')
            part = recovery / f'{index:04d}-attempt-{attempt}.part'
            if part.exists():
                raise ValueError('Unaccounted prior attempt retained; inspect instead of overwriting')
            args = ['curl.exe', '--fail', '--location', '--http1.1', '--no-progress-meter', '--connect-timeout', '15', '--max-time', '150', '--speed-limit', '1024', '--speed-time', '30', '--max-filesize', str(row['size']), '--output', str(part)]
            if proxy:
                args += ['--proxy', proxy]
            reservation = {'index': index, 'attempt': attempt, 'bytes': row['size'], 'status': 'reserved'}
            ledger['attempts'].append(reservation)
            ledger['totalBytesIncludingFailedAttempts'] += row['size']
            save(ledger_path, ledger)
            try:
                result = subprocess.run(args + [url_for(plan, row)], capture_output=True, text=True, timeout=160)
                code, error = result.returncode, result.stderr[-1500:]
            except subprocess.TimeoutExpired:
                code, error = -1, 'Transport exceeded bounded wall timeout'
            actual_bytes = part.stat().st_size if part.exists() else 0
            ledger['totalBytesIncludingFailedAttempts'] += actual_bytes - row['size']
            reservation.update(bytes=actual_bytes, code=code, error=error, status='verified' if code == 0 and verified(part, row) else 'failed')
            save(ledger_path, ledger)
            if reservation['status'] == 'verified':
                part.rename(target)
                print('verified-downloaded', index, flush=True)
                break
            print('failed-attempt', index, attempt, 'curl-code', code, flush=True)
    entries = export_links(root, plan)
    summary = {'verified': sum(r['verified'] for r in entries), 'missing': [r['index'] for r in entries if not r['verified']], 'totalBytesIncludingFailedAttempts': ledger['totalBytesIncludingFailedAttempts'], 'capBytes': CAP}
    save(recovery / 'summary.json', summary)
    print(json.dumps(summary), flush=True)
    if summary['missing']:
        raise RuntimeError('Missing files remain after bounded attempts; use browser links or inspect proxy')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'run/egolife-native-rgb-input-v1')
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--import-dir', type=Path)
    args = parser.parse_args()
    execute(args.root, args.download, args.import_dir)

"""Bounded public metadata/source audit; never fetch binaries or accept licenses."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.request

COMMIT = '01f56d4180c8dba2f5ca65430a61cb59e76b2ba0'
DATA_REV = '186d0ac9edb845169cef6357784dcd0b3e57d954'
SOURCES = {
    'unrealzoo-readme.md': f'https://raw.githubusercontent.com/UnrealZoo/unrealzoo-gym/{COMMIT}/README.md',
    'unrealzoo-registration.py.txt': f'https://raw.githubusercontent.com/UnrealZoo/unrealzoo-gym/{COMMIT}/gym_unrealcv/__init__.py',
    'unrealzoo-generate-config.py.txt': f'https://raw.githubusercontent.com/UnrealZoo/unrealzoo-gym/{COMMIT}/generate_env_config.py',
    'unrealzoo-recording-example.py.txt': f'https://raw.githubusercontent.com/UnrealZoo/unrealzoo-gym/{COMMIT}/example/DataRecording/VideoRecordingPipeline.py',
    'unrealzoo-license.txt': f'https://raw.githubusercontent.com/UnrealZoo/unrealzoo-gym/{COMMIT}/LICENSE',
    'unrealzoo-ue4-files.json': 'https://modelscope.cn/api/v1/datasets/UnrealZoo/UnrealZoo-UE4/repo/tree?Revision=master&Root=&Recursive=false&PageNumber=1&PageSize=100',
    'unrealzoo-ue5-full-files.json': f'https://modelscope.cn/api/v1/datasets/UnrealZoo/UnrealZoo-UE5/repo/tree?Revision={DATA_REV}&Root=UnrealZoo_UE5_7_v3.1.5&Recursive=false&PageNumber=1&PageSize=100',
    'unrealzoo-dataset-readme.md': f'https://modelscope.cn/datasets/UnrealZoo/UnrealZoo-UE5/resolve/{DATA_REV}/README.md',
    'unrealzoo-legacy-readme.md': 'https://raw.githubusercontent.com/UnrealZoo/unrealzoo-gym/v2.0/README.md',
    'unrealcv-command-contract.html': 'https://docs.unrealcv.org/en/latest/reference/commands.html',
    'unrealcv-zoo-command-contract.html': 'https://docs.unrealcv.org/en/latest/unrealcv_plus/reference/commands.html',
    'behavior-scenes.html': 'https://behavior.stanford.edu/behavior_components/scenes.html',
    'behavior-install.html': 'https://behavior.stanford.edu/getting_started/installation.html',
}
CAP = 1_000_000

def audit(output):
    output.mkdir(parents=True, exist_ok=False)
    def fetch(pair):
        name, url = pair
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'FirstSight-controllable-scene-audit/1'}), timeout=30) as response:
                raw = response.read(CAP + 1)
            if len(raw) > CAP:
                raise ValueError('Per-source 1MB cap')
            (output / name).write_bytes(raw)
            return {'file': name, 'url': url, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'status': 'retrieved'}
        except Exception as error:
            return {'file': name, 'url': url, 'status': 'failed', 'error': str(error), 'retried': False}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        receipts = list(pool.map(fetch, SOURCES.items()))
    packages = []
    for name in ['unrealzoo-ue4-files.json', 'unrealzoo-ue5-full-files.json']:
        path = output / name
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding='utf8'))
        for row in payload.get('Data', {}).get('Files', []):
            if row['Name'] in ['UE4_ExampleScene_Win_0422_25.zip', 'UnrealZoo_UE5_7_Win64_v3.1.5.zip']:
                packages.append({'name': row['Name'], 'path': row['Path'], 'bytes': row['Size'], 'revision': row['Revision'], 'sha256': row['Sha256'], 'downloaded': False})
    result = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'unrealzooCodeCommit': COMMIT, 'sources': receipts, 'packages': packages, 'binariesDownloaded': False, 'licensesAccepted': False, 'paidCalls': 0, 'allRequirementsVerified': False, 'note': 'API/source support is not runtime scene, indoor-outdoor continuity, synchronized three-camera or daily-life validation.'}
    (output / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.output)
    print(json.dumps({'retrieved': sum(r['status'] == 'retrieved' for r in result['sources']), 'failed': [r['file'] for r in result['sources'] if r['status'] != 'retrieved'], 'packages': result['packages'], 'binariesDownloaded': False, 'paidCalls': 0}, ensure_ascii=False))

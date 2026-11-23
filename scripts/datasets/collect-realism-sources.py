"""Collect public source evidence and bounded samples; never run models.

Writes a NEW ignored datasets/ directory. Pinned HF files are size/hash checked.
No credentials, gated-download bypass, simulator install or paid inference.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path, PurePosixPath
import time
import urllib.error
import urllib.request

LIMIT = 220 * 1024 * 1024
SOURCES = {
    'replicacad-card.md': 'https://huggingface.co/datasets/ai-habitat/ReplicaCAD_dataset/raw/main/README.md',
    'egolife-card.md': 'https://huggingface.co/datasets/lmms-lab/EgoLife/raw/main/README.md',
    'egolife-code-license.txt': 'https://raw.githubusercontent.com/EvolvingLMMs-Lab/EgoLife/main/LICENSE',
    'hssd-card.md': 'https://huggingface.co/datasets/hssd/hssd-hab/raw/main/README.md',
    'habitat-datasets.md': 'https://raw.githubusercontent.com/facebookresearch/habitat-sim/main/DATASETS.md',
    'hm3d-readme.md': 'https://raw.githubusercontent.com/matterport/habitat-matterport-3dresearch/main/README.md',
    'aea-download.html': 'https://facebookresearch.github.io/projectaria_tools/docs/open_datasets/aria_everyday_activities_dataset/aea_download_dataset',
    'aea-format.html': 'https://facebookresearch.github.io/projectaria_tools/docs/open_datasets/aria_everyday_activities_dataset/aea_data_format',
    'aea-hf-index.json': 'https://huggingface.co/api/datasets/projectaria/aria-everyday-activities',
    'egomemory-page.html': 'https://egomemory.github.io/',
    'embodiedscan-data.md': 'https://raw.githubusercontent.com/OpenRobotLab/EmbodiedScan/main/data/README.md',
}


def fetch(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'FirstSight-dataset-research/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read(limit + 1)
            break
        except urllib.error.HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)
    if len(data) > limit:
        raise ValueError('Response exceeded byte cap')
    return data


def api(path):
    return json.loads(fetch('https://huggingface.co/api/datasets/' + path, 8 * 1024 * 1024))


def safe_path(root, name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        raise ValueError('Unsafe dataset path')
    return root.joinpath(*path.parts)


def verify(data, row):
    if len(data) != row['size']:
        raise ValueError('Dataset file length mismatch')
    if row.get('lfs'):
        digest = hashlib.sha256(data).hexdigest()
        expected = row['lfs']['oid']
    else:
        digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        expected = row['oid']
    if digest != expected:
        raise ValueError('Dataset file hash mismatch')


def tree(repo, revision, folder='', recursive=True):
    url = f'https://huggingface.co/api/datasets/{repo}/tree/{revision}'
    if folder:
        url += '/' + folder
    # Explicit paging: a truncated listing must never be called a full snapshot.
    url += '?recursive=' + str(recursive).lower() + '&limit=1000'
    rows = []
    while url:
        with urllib.request.urlopen(url, timeout=90) as response:
            data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise ValueError('Tree response too large')
            rows.extend(json.loads(data))
            link = response.headers.get('Link', '')
        url = None
        for part in link.split(','):
            if 'rel="next"' in part:
                url = part.split('<', 1)[1].split('>', 1)[0]
                if not url.startswith('https://huggingface.co/api/datasets/'):
                    raise ValueError('Unexpected pagination host')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--replicacad', action='store_true', help='Download public CC BY 4.0 interactive assets')
    parser.add_argument('--egolife-sample', action='store_true', help='Download first three chronological DAY1 clips and public QA, not a scored set')
    parser.add_argument('--resume', action='store_true', help='Reverify cached bytes and resume this collection; preserve failures and pinned revisions')
    args = parser.parse_args()
    root = args.output.resolve()
    if args.resume:
        receipt = json.loads((root / 'receipt.json').read_text(encoding='utf-8'))
        if 'failure' in receipt:
            receipt.setdefault('previousFailures', []).append(receipt.pop('failure'))
    else:
        root.mkdir(parents=True, exist_ok=False)
        receipt = {'retrievedAt': datetime.now(timezone.utc).isoformat(), 'sources': [], 'datasets': [],
                   'paidCalls': 0, 'scoreEligible': False, 'byteCap': LIMIT}

    def save_receipt():
        (root / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    try:
        for name, url in SOURCES.items():
            cached = next((r for r in receipt['sources'] if r['path'] == 'sources/' + name), None)
            if cached:
                data = (root / cached['path']).read_bytes()
                if hashlib.sha256(data).hexdigest() != cached['sha256']:
                    raise ValueError('Cached source hash mismatch')
                continue
            data = fetch(url, 2 * 1024 * 1024)
            path = root / 'sources' / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(data)
            receipt['sources'].append({'path': 'sources/' + name, 'url': url, 'bytes': len(data),
                                       'sha256': hashlib.sha256(data).hexdigest()})
            save_receipt()
        plans = []
        for repo, enabled in [('ai-habitat/ReplicaCAD_dataset', args.replicacad), ('lmms-lab/EgoLife', args.egolife_sample)]:
            info = api(repo)
            revision = info['sha']
            previous = next((d for d in receipt['datasets'] if d['repo'] == repo), None)
            if previous:
                revision = previous['revision']
            if info.get('gated'):
                raise ValueError('Dataset is gated; obtain user-approved access separately')
            if not enabled:
                continue
            if repo.endswith('ReplicaCAD_dataset'):
                rows = [r for r in tree(repo, revision) if r['type'] == 'file']
            else:
                clips = [r for r in tree(repo, revision, 'A1_JAKE/DAY1') if r['type'] == 'file' and r['path'].endswith('.mp4')]
                rows = sorted(clips, key=lambda r: r['path'])[:3]
                rows += [r for r in tree(repo, revision, 'EgoLifeQA') if r['type'] == 'file']
                rows += [r for r in tree(repo, revision, recursive=False) if r['type'] == 'file' and r['path'] == 'README.md']
            plans.append((repo, revision, rows))
        total = sum(r['size'] for _, _, rows in plans for r in rows)
        if total > LIMIT:
            raise ValueError('Planned sample exceeds total byte cap')
        for repo, revision, rows in plans:
            entry = next((d for d in receipt['datasets'] if d['repo'] == repo), None)
            if entry is None:
                entry = {'repo': repo, 'revision': revision, 'plannedBytes': sum(r['size'] for r in rows),
                         'plannedFiles': len(rows), 'files': [], 'complete': False}
                receipt['datasets'].append(entry)
            entry['files'] = []
            entry['complete'] = False
            save_receipt()

            def download(row):
                path = safe_path(root / repo.split('/')[-1], row['path'])
                url = f'https://huggingface.co/datasets/{repo}/resolve/{revision}/' + row['path']
                data = path.read_bytes() if path.exists() else fetch(url, row['size'])
                verify(data, row)
                path.parent.mkdir(parents=True, exist_ok=True)
                if not path.exists():
                    path.write_bytes(data)
                return {'path': str(path.relative_to(root)).replace('\\', '/'), 'url': url,
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

            with ThreadPoolExecutor(max_workers=6) as pool:
                for result in pool.map(download, rows):
                    entry['files'].append(result)
                    save_receipt()
            entry['complete'] = True
            save_receipt()
            print(f"{repo}: {len(rows)} verified files, {entry['plannedBytes']} bytes")
    except Exception as error:
        receipt['failure'] = {'type': type(error).__name__, 'message': str(error).split('?', 1)[0]}
        save_receipt()
        raise
    print('Collection complete; no simulator, model calls or score claims.')


if __name__ == '__main__':
    main()

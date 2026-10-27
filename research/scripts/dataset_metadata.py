"""Inspect public HF dataset metadata only; no assets, credentials or gated access."""
import datetime
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPOS = ['yali30/hssd-hab', 'ai-habitat/OVMM_objects',
         'yali30/findingdory-habitat', 'yali30/findingdory', 'Baymax-12/SpaceLocQA']


def main():
    result = {}
    for repo in REPOS:
        try:
            url = 'https://huggingface.co/api/datasets/' + repo + '?blobs=true'
            with urllib.request.urlopen(url, timeout=45) as response:
                data = json.load(response)
            files = data.get('siblings', [])
            sizes = [f.get('size', f.get('lfs', {}).get('size')) for f in files]
            result[repo] = {'sha': data.get('sha'), 'gated': data.get('gated'),
                            'cardData': data.get('cardData'), 'files': files,
                            'knownBytes': sum(s for s in sizes if isinstance(s, int)),
                            'unknownSizes': sum(not isinstance(s, int) for s in sizes)}
        except Exception as error:
            result[repo] = {'error': str(error)}
        row = result[repo]
        print(repo, 'bytes=', row.get('knownBytes'), 'gated=', row.get('gated'), 'error=', row.get('error'))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = ROOT / 'reports' / f'dataset-metadata-{stamp}.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(target)


if __name__ == '__main__':
    main()

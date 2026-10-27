"""Download pinned small validation metadata; no scene/model assets or inference."""
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    metadata = json.loads((ROOT / 'reports/dataset-metadata-20261025T110832Z.json').read_text(encoding='utf-8'))
    repo = 'yali30/findingdory-habitat'
    sha = metadata[repo]['sha']
    output = ROOT / 'data/findingdory-metadata'
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'repo': repo, 'revision': sha, 'files': {}}
    for relative in ('README.md', 'findingdory/val/episodes.json.gz',
                     'findingdory/val/transformations.npy', 'findingdory/val/viewpoints.npy'):
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://huggingface.co/datasets/{repo}/resolve/{sha}/{relative}'
        with urllib.request.urlopen(url, timeout=90) as response:
            content = response.read(32 * 1024 * 1024 + 1)
        if len(content) > 32 * 1024 * 1024:
            raise ValueError('Metadata exceeds 32 MiB bound')
        target.write_bytes(content)
        manifest['files'][relative] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
    with gzip.open(output / 'findingdory/val/episodes.json.gz', 'rt') as stream:
        dataset = json.load(stream)
    episodes = dataset['episodes']
    manifest['episodeCount'] = len(episodes)
    manifest['topLevelKeys'] = list(dataset)
    manifest['firstEpisode'] = episodes[0]
    manifest['sceneIds'] = sorted({episode['scene_id'] for episode in episodes})
    (ROOT / 'reports/findingdory-validation-inspection.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('episodes', len(episodes), 'scenes', len(manifest['sceneIds']))
    print('first keys', list(episodes[0]))
    print('first scene', episodes[0]['scene_id'])


if __name__ == '__main__':
    main()

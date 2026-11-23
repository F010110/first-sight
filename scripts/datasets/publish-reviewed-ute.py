"""Publish approved local UTE originals to loopback replay. Never edits source pixels."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8*1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--review', type=Path, required=True)
    p.add_argument('--archive', type=Path, required=True)
    args = p.parse_args()
    technical = json.loads((args.review / 'technical-review.json').read_text(encoding='utf8'))
    approval = json.loads((args.review / 'visual-review.json').read_text(encoding='utf8'))
    for row in technical['videos']:
        name = row['name']
        approved = next((r for r in approval['videos'] if r['name'] == name), None)
        if not approved or approved['sha256'] != row['sha256'] or approved['decision'] != 'local-preview-only':
            raise ValueError('Missing hash-bound visual review')
        source = Path(row['sourceFile'])
        if sha(source) != row['sha256']:
            raise ValueError('Reviewed original changed')
        root = args.archive / ('ute-' + name.lower() + '-long')
        (root / 'clips').mkdir(parents=True, exist_ok=False)
        try:
            target = root / 'clips/0000.mp4'
            shutil.copyfile(source, target)
            if sha(target) != row['sha256']:
                raise ValueError('Published copy differs from original')
            manifest = {'schema': 'original-real-video-v1', 'title': approved['title'], 'source': 'UT Egocentric',
                        'sourceUrl': 'https://vision.cs.utexas.edu/projects/egocentric_data/UT_Egocentric_Dataset.html',
                        'scope': approved['scope'], 'cameraCount': 1, 'durationMs': row['durationMs'],
                        'previewRecommended': True, 'modelCalls': 0, 'scoreEligible': False,
                        'license': 'Official public research download; no explicit redistribution grant asserted. User-authorized private loopback inspection only; not externally uploaded or publicly re-hosted.',
                        'review': {'kind': 'assistant visual screening, not independent human truth', 'sampleCount': len(row['screenedTimesSeconds']),
                                   'fullVideoDecode': True, 'frames': row['decodedFrames'], 'fps': row['fps']},
                        'clips': [{'file': 'clips/0000.mp4', 'bytes': row['bytes'], 'sha256': row['sha256'], 'durationMs': row['durationMs']}]}
            (root / 'SOURCE-NOTICE.md').write_text('UT Egocentric (UTE). Yong Jae Lee, Joydeep Ghosh, Kristen Grauman; Zheng Lu and Kristen Grauman. Official research release, CVPR 2012/2013. Original released MP4 copied unchanged; no upscaling, speed change, interpolation, stitching or added views. Private localhost preview, not a public redistribution license.\n', encoding='utf8')
            (root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')
            print(json.dumps({'id': root.name, 'durationMs': row['durationMs'], 'sha256': row['sha256']}), flush=True)
        except Exception as error:
            (root / 'failure.json').write_text(json.dumps({'error': str(error)}))
            raise

if __name__ == '__main__':
    main()

"""Export source-only HSSD capture windows into the generic spatial replay schema.

Never reads prelabels, collector region IDs, poses, predictions or summaries.
JPEG originals are decoded to PNG without resizing; decoded pixels are verified.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from PIL import Image


def export(captures, output, count):
    if count < 2 or not captures or len({scene for scene, _ in captures}) != len(captures):
        raise ValueError('Require unique scenes and at least two requested windows')
    if any(not re.fullmatch(r'[A-Za-z0-9_-]+', scene) for scene, _ in captures):
        raise ValueError('Unsafe scene ID')
    output.mkdir(parents=True, exist_ok=False)
    observations = []
    receipts = []
    for scene, directory in captures:
        directory = Path(directory)
        raw = (directory / 'windows.jsonl').read_bytes()
        windows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        if len(windows) < count:
            raise ValueError('Not enough distinct source windows')
        selected = [windows[round(i * (len(windows) - 1) / (count - 1))] for i in range(count)]
        previous = -1
        for row in selected:
            timestamp = row['timestampMs']
            frame = row['frame']
            if not isinstance(timestamp, (int, float)) or timestamp <= previous or Path(frame).name != frame:
                raise ValueError('Invalid source clock/frame')
            previous = timestamp
            observation_id = scene + '-' + Path(frame).stem
            views = []
            for direction, folder in [('front', 'frames'), ('left', 'left'), ('right', 'right')]:
                source = (directory / folder / frame).resolve()
                destination = output / (observation_id + '-' + direction + '.png')
                with Image.open(source) as image:
                    if image.mode != 'RGB':
                        raise ValueError('No implicit color conversion')
                    image.save(destination)
                    with Image.open(destination) as decoded:
                        if image.size != decoded.size or image.tobytes() != decoded.tobytes():
                            raise ValueError('Derived PNG changed decoded source pixels')
                digest = hashlib.sha256(destination.read_bytes()).hexdigest()
                views.append({'direction': direction, 'path': str(destination.resolve()), 'sha256': digest})
                receipts.append({'id': observation_id, 'direction': direction, 'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'derivedPngSha256': digest, 'decodedPixelsUnchanged': True})
            observations.append({'id': observation_id, 'scene': scene, 'atMs': timestamp, 'views': views})
        receipts.append({'scene': scene, 'sourceWindowsSha256': hashlib.sha256(raw).hexdigest(), 'selectedSourceFrames': [r['frame'] for r in selected], 'sourceWindowCount': len(windows)})
    (output / 'public.json').write_text(json.dumps({'schema': 'spatial-public-replay-v1', 'observations': observations}, indent=2), encoding='utf-8')
    (output / 'provenance.json').write_text(json.dumps({'receipts': receipts, 'selection': 'Uniform deterministic source-window sampling before inference; sparse replay, not full-rate route', 'labelsRead': False, 'license': 'Source HSSD license applies; local artifacts not for redistribution'}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', nargs=2, action='append', metavar=('SCENE', 'CAPTURE_DIRECTORY'), required=True)
    parser.add_argument('--count', type=int, default=8)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    export(args.capture, args.output, args.count)

"""Inventory/hash, sample-time and full video-decode audit; no inference labels."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    import cv2
    parser = argparse.ArgumentParser(); parser.add_argument('dataset',type=Path); parser.add_argument('output',type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.dataset/'manifest.json').read_text())
    windows = [json.loads(line) for line in (args.dataset/'windows.jsonl').read_text().splitlines()]
    expected = list(manifest['triptychSha256'])
    for directory in ['left','frames','right','triple']:
        if sorted(p.name for p in (args.dataset/directory).glob('*.jpg')) != sorted(expected):
            raise ValueError('Unpaired frame inventory: '+directory)
    for name,sha in manifest['triptychSha256'].items():
        if hashlib.sha256((args.dataset/'triple'/name).read_bytes()).hexdigest() != sha:
            raise ValueError('Original triple changed: '+name)
    for row in windows:
        if row['frame'] != f"{row['endTick']:04d}.jpg" or row['timestampMs'] != row['endTick']*500:
            raise ValueError('Sample/time mismatch')
    video = cv2.VideoCapture(str(args.dataset/'motion-24fps.mp4'))
    if not video.isOpened() or abs(video.get(cv2.CAP_PROP_FPS)-24) > .01:
        raise ValueError('Invalid 24fps video')
    frames = 0; differences = []
    while True:
        ok,image = video.read()
        if not ok:
            break
        if frames % 12 == 0:
            name = f'{frames//12:04d}.jpg'
            originals = [cv2.imread(str(args.dataset/v/name)) for v in ['left','frames','right']]
            if any(im is None for im in originals):
                raise ValueError('Video sample inventory mismatch')
            for start,original in zip([0,344,688],originals):
                differences.append(float(cv2.absdiff(image[:,start:start+320],original).mean()))
        frames += 1
    video.release()
    if frames != manifest['denseFrames'] or max(differences,default=100) > 15:
        raise ValueError('Video decoding/alignment failed')
    result = {'protocol':'hssd-capture-quality-audit-v1','passed':True,'denseFramesDecoded':frames,'samples':len(windows),'maxVideoSampleMeanPixelDifference':max(differences),'originalHashesVerified':len(expected),'correctness':'Not a region-label accuracy test'}
    args.output.write_text(json.dumps(result,indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()

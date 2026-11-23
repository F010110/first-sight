"""Offline full-decode inspection of collected samples (requires OpenCV).

Writes a NEW inspection directory beside originals. Frames are contact-sheet
thumbnails only, not model inputs. No inference or ground-truth generation.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collection', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    import cv2
    from PIL import Image, ImageDraw

    args.output.mkdir(parents=True, exist_ok=False)
    receipt = json.loads((args.collection / 'receipt.json').read_text(encoding='utf-8'))
    for dataset in receipt['datasets']:
        if not dataset['complete']:
            raise ValueError('Collection is incomplete')
        for row in dataset['files']:
            content = (args.collection / row['path']).read_bytes()
            if len(content) != row['bytes'] or hashlib.sha256(content).hexdigest() != row['sha256']:
                raise ValueError('Collected original integrity check failed')
    result = {'videos': [], 'qa': {}, 'modelCalls': 0, 'scoreEligible': False}
    tiles = []
    for path in sorted((args.collection / 'EgoLife').rglob('*.mp4')):
        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            raise ValueError('Video cannot be opened: ' + path.name)
        expected = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = capture.get(cv2.CAP_PROP_FPS)
        width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        indices = {0, expected // 2, max(0, expected - 1)}
        count = 0
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if count in indices:
                    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    image.thumbnail((360, 270))
                    tile = Image.new('RGB', (380, 310), 'white')
                    tile.paste(image, ((380 - image.width) // 2, 30))
                    ImageDraw.Draw(tile).text((8, 8), f'{path.stem} / frame {count}', fill='black')
                    tiles.append(tile)
                count += 1
        finally:
            capture.release()
        if count != expected or fps <= 0:
            raise ValueError('Incomplete video decode: ' + path.name)
        result['videos'].append({'file': path.name, 'width': width, 'height': height, 'fps': fps,
                                  'decodedFrames': count, 'durationSecondsFromFrames': count / fps,
                                  'cameraViews': 1, 'missingViews': ['left', 'right']})
    qa = json.loads((args.collection / 'EgoLife/EgoLifeQA/EgoLifeQA_A1_JAKE.json').read_text(encoding='utf-8'))
    result['qa'] = {'benchmark': 'EgoLifeQA (NOT EgoMemory)', 'count': len(qa),
                    'fields': list(qa[0]) if qa else [],
                    'matchedEvidenceCoverage': 'not checked; these three clips are NOT a complete QA benchmark'}
    if tiles:
        sheet = Image.new('RGB', (380 * 3, 310 * ((len(tiles) + 2) // 3)), 'white')
        for index, tile in enumerate(tiles):
            sheet.paste(tile, ((index % 3) * 380, (index // 3) * 310))
        sheet.save(args.output / 'contact-sheet.jpg')
    (args.output / 'inspection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

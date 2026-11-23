"""Bounded official UTE download and offline contact sheet; no model inputs or paid calls."""
import argparse
import hashlib
import json
import zipfile
import urllib.request
from pathlib import Path

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    root = args.output
    root.mkdir(parents=True, exist_ok=False)
    receipt = {'source': 'https://vision.cs.utexas.edu/projects/egocentric/download.php',
               'notice': 'Official optional newsletter form left blank; no email, registration, license signature or model call. Local SHA256 is NOT upstream integrity certification.',
               'complete': False}
    try:
        archive = root / 'UTE_video.zip'
        h = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(receipt['source'], timeout=90) as response, archive.open('wb') as out:
            if 'zip' not in response.headers.get('Content-Type', ''):
                raise ValueError('Expected official ZIP response')
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > 1800 * 1024 * 1024:
                    raise ValueError('Official archive exceeds download cap')
                h.update(chunk)
                out.write(chunk)
        receipt.update({'bytes': size, 'localSha256': h.hexdigest()})
        import cv2
        from PIL import Image, ImageDraw
        rows = []
        tiles = []
        with zipfile.ZipFile(archive) as z:
            files = z.infolist()
            if len(files) > 30 or sum(f.file_size for f in files) > 3 * 1024 ** 3:
                raise ValueError('Unexpected archive expansion')
            for entry in files:
                if not entry.filename.lower().endswith('.mp4'):
                    continue
                name = Path(entry.filename).name
                if name != entry.filename or not name.startswith('P'):
                    raise ValueError('Unexpected archive member path')
                video = root / name
                # Copy through ZipExtFile to verify ZIP CRC while extracting; never extractall.
                with z.open(entry) as src, video.open('wb') as out:
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                cap = cv2.VideoCapture(str(video))
                fps, frames = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
                if not cap.isOpened() or fps <= 0 or frames <= 0:
                    raise ValueError('Unreadable released video')
                row = {'file': name, 'fps': fps, 'frames': frames, 'containerDurationSeconds': frames/fps,
                       'width': cap.get(cv2.CAP_PROP_FRAME_WIDTH), 'height': cap.get(cv2.CAP_PROP_FRAME_HEIGHT), 'samples': []}
                for fraction in [.02, .2, .4, .6, .8, .98]:
                    frame = int((frames-1)*fraction)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
                    ok, image = cap.read()
                    if not ok:
                        raise ValueError('Cannot inspect selected frame')
                    tile = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                    tile.thumbnail((320, 240))
                    canvas = Image.new('RGB', (320, 266), '#12201a')
                    canvas.paste(tile, ((320-tile.width)//2, 0))
                    ImageDraw.Draw(canvas).text((5, 244), f'{name} media {frame/fps:.1f}s ({fraction:.0%})', fill='white')
                    tiles.append(canvas)
                    row['samples'].append({'frame': frame, 'mediaAtSeconds': frame/fps})
                cap.release()
                rows.append(row)
                print(json.dumps(row), flush=True)
        if len(rows) != 4:
            raise ValueError('Expected four released UTE videos')
        sheet = Image.new('RGB', (1920, 1064), '#12201a')
        for i, tile in enumerate(tiles):
            sheet.paste(tile, ((i%6)*320, (i//6)*266))
        sheet.save(root / 'contact-sheet.jpg')
        receipt.update({'complete': True, 'videos': rows, 'warning': 'Media duration is not assumed to equal original capture duration; inspect released frame rate and any time compression. Six samples per video are initial screening, not proof of complete route or revisits.'})
    except Exception as error:
        receipt['error'] = str(error)
        raise
    finally:
        (root / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf8')

if __name__ == '__main__':
    main()

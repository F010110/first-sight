"""Full decode and five-minute visual screening. Publication is a separate manual step."""
import argparse
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    root = args.output
    root.mkdir(parents=True, exist_ok=False)
    import cv2
    import imageio_ffmpeg
    from PIL import Image, ImageDraw
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    all_rows = []
    try:
        for name in ['P04', 'P01']:
            path = args.source / (name + '.mp4')
            # Read from original without rewriting/re-encoding it.
            result = subprocess.run([ffmpeg, '-hide_banner', '-v', 'info', '-xerror', '-i', str(path), '-map', '0:v:0', '-an', '-f', 'null', '-'], capture_output=True, text=True)
            (root / f'{name}-full-decode.log').write_text(result.stderr, encoding='utf8')
            if result.returncode:
                raise ValueError(f'{name}: complete decoding failed')
            decoded = re.findall(r'frame=\s*(\d+)', result.stderr)
            cap = cv2.VideoCapture(str(path))
            fps, frames = cap.get(cv2.CAP_PROP_FPS), int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if not decoded or int(decoded[-1]) != frames or fps <= 0:
                raise ValueError('Decoded/container frame count mismatch')
            seconds = frames / fps
            times = list(range(0, math.floor(seconds), 300)) + [max(0, seconds - 2)]
            tile_w, tile_h = 320, 236
            for page in range(math.ceil(len(times)/24)):
                subset = times[page*24:(page+1)*24]
                sheet = Image.new('RGB', (tile_w*6, tile_h*4), '#14201b')
                for index, t in enumerate(subset):
                    cap.set(cv2.CAP_PROP_POS_MSEC, t*1000)
                    ok, pixels = cap.read()
                    if not ok:
                        raise ValueError(f'Cannot screen {name} at {t}')
                    image = Image.fromarray(cv2.cvtColor(pixels, cv2.COLOR_BGR2RGB))
                    image.thumbnail((320, 212))
                    x, y = (index%6)*tile_w, (index//6)*tile_h
                    sheet.paste(image, (x, y))
                    code = f'{int(t)//3600:02d}:{int(t)//60%60:02d}:{int(t)%60:02d}'
                    ImageDraw.Draw(sheet).text((x+5, y+215), f'{name} media {code}', fill='white')
                sheet.save(root / f'{name}-sheet-{page+1}.jpg')
            cap.release()
            row = {'sourceFile': str(path.resolve()), 'name': name, 'sha256': sha(path), 'bytes': path.stat().st_size,
                   'fps': fps, 'decodedFrames': frames, 'durationMs': round(seconds*1000), 'screenedTimesSeconds': times,
                   'reviewStatus': 'awaiting visual review; full decoding passed', 'scoreEligible': False}
            all_rows.append(row)
            print(json.dumps(row), flush=True)
        (root / 'technical-review.json').write_text(json.dumps({'videos': all_rows, 'modelCalls': 0,
            'warning': 'Five-minute sampling is not full semantic review; exact scene transitions, recording cuts, true calendar time and place identity remain unverified.'}, indent=2), encoding='utf8')
    except Exception as error:
        (root / 'failure.json').write_text(json.dumps({'error': str(error), 'completed': all_rows}, indent=2))
        raise

if __name__ == '__main__':
    main()

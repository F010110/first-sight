"""Pinned, bounded EgoLife collection for read-only original-video replay. No QA/model calls."""
import concurrent.futures
import hashlib
import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path
import argparse

REV = '143fb319be7aa5ae210c936bf4f0f3a86092afb0'
BASE = 'https://huggingface.co'

def fetch(url):
    for attempt in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'FirstSight-dataset-preview/2'}), timeout=90)
        except OSError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    root = args.output
    root.mkdir(parents=True, exist_ok=False)
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for day in ['DAY1', 'DAY2']:
        target = root / ('egolife-jake-' + day.lower() + '-20min')
        (target / 'clips').mkdir(parents=True)
        try:
            url = f'{BASE}/api/datasets/lmms-lab/EgoLife/tree/{REV}/A1_JAKE/{day}?recursive=false&limit=60'
            with fetch(url) as response:
                listing = json.load(response)
            (target / 'source-listing.json').write_text(json.dumps(listing, indent=2))
            files = sorted([r for r in listing if r['type'] == 'file' and r['path'].endswith('.mp4')], key=lambda r: r['path'])[1:41]
            if len(files) != 40 or sum(r['size'] for r in files) > 1100 * 1024 * 1024:
                raise ValueError('Insufficient files or collection byte limit exceeded')
            (target / 'plan.json').write_text(json.dumps({'revision': REV, 'files': files, 'modelCalls': 0}, indent=2))

            def download(pair):
                index, row = pair
                if not re.fullmatch(r'A1_JAKE/DAY[12]/DAY[12]_A1_JAKE_\d{8}\.mp4', row['path']):
                    raise ValueError('Unexpected source path')
                path = target / 'clips' / f'{index:04d}.mp4'
                expected = row['lfs']['oid']
                for attempt in range(3):
                    try:
                        h = hashlib.sha256()
                        count = 0
                        with fetch(f"{BASE}/datasets/lmms-lab/EgoLife/resolve/{REV}/{row['path']}") as response, path.open('wb') as out:
                            while True:
                                chunk = response.read(1024 * 1024)
                                if not chunk:
                                    break
                                count += len(chunk)
                                if count > row['size']:
                                    raise ValueError('Download exceeds pinned size')
                                h.update(chunk)
                                out.write(chunk)
                        if count != row['size'] or h.hexdigest() != expected:
                            raise ValueError('Original hash/size mismatch')
                        break
                    except Exception as error:
                        with (target / f'download-{index:04d}-failures.jsonl').open('a') as log:
                            log.write(json.dumps({'attempt': attempt + 1, 'error': str(error)}) + '\n')
                        if attempt == 2:
                            raise
                # Decode full original, not just container metadata. Keep diagnostics.
                result = subprocess.run([ffmpeg, '-hide_banner', '-v', 'info', '-xerror', '-i', str(path), '-map', '0:v:0', '-an', '-f', 'null', '-'], capture_output=True, text=True)
                (target / f'decode-{index:04d}.log').write_text(result.stderr)
                if result.returncode:
                    raise ValueError('Video failed complete decoding')
                frames = re.findall(r'frame=\s*(\d+)', result.stderr)
                rate = re.search(r'(\d+(?:\.\d+)?) fps', result.stderr)
                if not frames or not rate:
                    raise ValueError('No verified frame count/rate')
                duration = int(frames[-1]) / float(rate.group(1))
                if abs(duration - 30) > .15:
                    raise ValueError('Expected full 30 second source segment')
                print(day, index, 'verified', duration, flush=True)
                return {'file': f'clips/{index:04d}.mp4', 'bytes': count, 'sha256': expected, 'durationMs': round(duration * 1000), 'sourcePath': row['path']}

            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                clips = list(pool.map(download, enumerate(files)))
            # Source filenames are HHMMSScc; reject missing segments instead of hiding gaps.
            def source_ms(clip):
                clock = Path(clip['sourcePath']).stem.split('_')[-1]
                return (int(clock[:2])*3600 + int(clock[2:4])*60 + int(clock[4:6]))*1000 + int(clock[6:])*10
            for a, b in zip(clips, clips[1:]):
                if abs(source_ms(b)-source_ms(a)-a['durationMs']) > 150:
                    raise ValueError('Source clock gap; refuse continuous preview claim')
            manifest = {'schema': 'original-real-video-v1', 'title': f'EgoLife · JAKE · {day} · 20分钟真实生活',
                        'source': 'EgoLife', 'sourceUrl': 'https://huggingface.co/datasets/lmms-lab/EgoLife', 'revision': REV,
                        'scope': '真人第一视角原始发布视频；单摄鱼眼，保留烧录时间/人物标识；非校园、无模型判断或问答真值。原片按顺序播放，片段切换可能短暂缓冲。',
                        'cameraCount': 1, 'clock': 'source-relative; original source filenames retained in provenance',
                        'durationMs': sum(c['durationMs'] for c in clips), 'clips': clips, 'modelCalls': 0,
                        'license': 'Dataset card: MIT; code license is separate. Original notices retained; local preview only.'}
            with fetch(f'{BASE}/datasets/lmms-lab/EgoLife/resolve/{REV}/README.md') as response:
                (target / 'SOURCE-README.md').write_bytes(response.read())
            (target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')
        except Exception as error:
            (target / 'failure.json').write_text(json.dumps({'error': str(error)}, indent=2))
            raise

if __name__ == '__main__':
    main()

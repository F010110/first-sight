"""Bounded first-10 official-question RGB prefix. No captions, no model calls.

Explicit permission flags are required: prior local-preview receipts are NOT reused
as cloud-processing permission. Uses pinned public source hashes, native VGA JPEG
preparation, and source clocks. Downloads at most 1.8GB, with no automatic retries.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('egolife_audit', Path(__file__).with_name('inspect-egolife-integration.py'))
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
REV = '143fb319be7aa5ae210c936bf4f0f3a86092afb0'
CAP = 1_800_000_000

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def prepare(output, listing, authorized, resume=False, prepare_only=False):
    if not authorized:
        raise ValueError('Requires explicit public-video download AND Qwen image-upload authorization')
    if output.exists() and not (resume or prepare_only):
        raise FileExistsError('Use a fresh directory; no overwriting receipts or silent resume')
    rows = json.loads(audit.QA.read_text(encoding='utf8'))
    selected = sorted(rows, key=lambda r: audit.clock(r['query_time']['date'], r['query_time']['time'])['cutoffMs'])[:10]
    tasks = [audit.public_task(r) for r in selected]
    cutoff = max(t['cutoffMs'] for t in tasks)
    sources = json.loads(listing.read_text(encoding='utf8'))
    files = sorted([r for r in sources if r.get('type') == 'file' and r['path'].endswith('.mp4') and audit.clock('DAY1', Path(r['path']).stem.rsplit('_', 1)[-1])['cutoffMs'] <= cutoff], key=lambda r: r['path'])
    if len(files) != 136 or sum(r['size'] for r in files) > CAP:
        raise ValueError('Pinned first-10 prefix changed or exceeds 1.8GB cap')
    if resume or prepare_only:
        plan = json.loads((output / 'plan.json').read_text(encoding='utf8'))
        if plan['revision'] != REV or plan['files'] != files or json.loads((output / 'public-tasks.json').read_text(encoding='utf8')) != tasks:
            raise ValueError('Resume cannot change the frozen source files or questions')
        if (output / 'jpeg').exists() or (output / 'prepared.json').exists():
            raise ValueError('Only interrupted downloads may be explicitly resumed, not preparation or inference')
        if not prepare_only:
            receipt = output / 'explicit-download-recovery.json'
            if receipt.exists():
                raise ValueError('One recovery only; no indefinite network retries')
            save(receipt, {'reason': 'TLS EOF in initial download; manually initiated one bounded continuation', 'reuse': 'only complete files matching pinned SHA256', 'paidCalls': 0, 'capBytes': CAP})
    else:
        output.mkdir(parents=True)
        (output / 'clips').mkdir()
        save(output / 'plan.json', {'revision': REV, 'files': files, 'totalBytes': sum(r['size'] for r in files), 'capBytes': CAP, 'selection': 'first10 official questions in source-clock order; no gold/evidence filtering', 'cloudProcessingAuthorized': True, 'samplingIntervalMs': 2000, 'audioProvided': False, 'modelCalls': 0})
        save(output / 'public-tasks.json', tasks)
        save(output / 'gold.json', {str(r['ID']): r['answer'] for r in selected})
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    def download(pair):
        index, row = pair
        path = output / 'clips' / f'{index:04d}.mp4'
        if path.exists():
            raw = path.read_bytes()
            if len(raw) != row['size'] or hashlib.sha256(raw).hexdigest() != row['lfs']['oid']:
                raise ValueError('Partial/corrupt source retained; refusing to overwrite it: ' + str(path))
            print('verified-existing', index, flush=True)
            return index, path, row
        if prepare_only:
            raise ValueError('Preparation-only cannot download missing source: ' + str(path))
        url = f"https://huggingface.co/datasets/lmms-lab/EgoLife/resolve/{REV}/{row['path']}"
        if resume:
            # One alternate transport for the observed Python TLS failure, no retries.
            transport = subprocess.run(['curl.exe', '--fail', '--location', '--no-progress-meter', '--connect-timeout', '30', '--max-time', '180', '--max-filesize', str(row['size']), '--output', str(path), url], capture_output=True, text=True, timeout=190)
            if transport.returncode:
                save(output / f'download-{index:04d}-recovery-failure.json', {'code': transport.returncode, 'stderr': transport.stderr[-2000:], 'automaticRetry': False})
                raise ValueError('Bounded alternate download failed: ' + str(index))
            raw = path.read_bytes()
            if len(raw) != row['size'] or hashlib.sha256(raw).hexdigest() != row['lfs']['oid']:
                raise ValueError('Alternate download pinned hash mismatch')
            print('downloaded', index, flush=True)
            return index, path, row
        h = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(url, timeout=90) as response, path.open('xb') as stream:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > row['size']:
                    raise ValueError('Source exceeds pinned byte count')
                h.update(chunk)
                stream.write(chunk)
        if size != row['size'] or h.hexdigest() != row['lfs']['oid']:
            raise ValueError('Pinned source hash mismatch')
        print('downloaded', index, flush=True)
        return index, path, row

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        downloaded = list(pool.map(download, enumerate(files)))
    originals = []
    first = audit.clock('DAY1', Path(files[0]['path']).stem.rsplit('_', 1)[-1])['cutoffMs']
    gaps = []
    for index, path, row in downloaded:
        start = audit.clock('DAY1', Path(row['path']).stem.rsplit('_', 1)[-1])['cutoffMs']
        frame_root = output / 'jpeg' / f'{index:04d}'
        frame_root.mkdir(parents=True)
        # Full decode with xerror; scale/pad never crops out identities or timestamps.
        command = [ffmpeg, '-hide_banner', '-v', 'info', '-xerror', '-i', str(path), '-an', '-vf', "select='isnan(prev_selected_t)+gte(t-prev_selected_t,2)',showinfo,scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2", '-vsync', 'vfr', '-q:v', '2', str(frame_root / '%05d.jpg')]
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        (output / f'decode-{index:04d}.log').write_text(result.stderr, encoding='utf8')
        if result.returncode:
            raise ValueError('Source failed full video decode')
        frames = sorted(frame_root.glob('*.jpg'))
        frame_times = [float(t) for t in re.findall(r'\bn:\s*\d+.*?\bpts_time:([0-9.e+\-]+)', result.stderr)]
        if not frames or len(frames) != len(frame_times):
            raise ValueError('Missing decoded-frame timestamps; never infer PTS from output index')
        for offset, jpeg in enumerate(frames):
            at = start + round(frame_times[offset] * 1000)
            if at > cutoff:
                continue
            png = output / 'png' / f'{index:04d}-{offset:04d}.png'
            raw = jpeg.read_bytes()
            jpeg_hash = hashlib.sha256(raw).hexdigest()
            native = subprocess.run([sys.executable, str(ROOT / 'cam/host/prepare_live_image.py')], input=json.dumps({'source': str(jpeg.resolve()), 'destination': str(png.resolve()), 'sha256': jpeg_hash}), capture_output=True, text=True, timeout=15)
            if native.returncode:
                raise ValueError('Native image preparation failed: ' + native.stderr[-1000:])
            prepared = json.loads(native.stdout)
            if originals and at - originals[-1]['atMs'] > 2200:
                gaps.append([originals[-1]['atMs'], at])
            originals.append({'id': f'egolife-{index:04d}-{offset:04d}', 'atMs': at, 'requestWallTimeMs': at, 'receivedAtMs': at, 'jpegPath': str(jpeg.resolve()), 'jpegSha256': jpeg_hash, 'pngPath': prepared['path'], 'pngSha256': prepared['sha256'], 'features': prepared['features']})
        print('prepared', index, 'observations', len(originals), flush=True)
    if gaps:
        save(output / 'source-gaps.json', gaps)
        raise ValueError('Source/sampling gap: do not claim a complete prefix')
    save(output / 'native-input.json', {'schema': 'egolife-native-rgb-replay-v1', 'cloudProcessingAuthorized': True, 'samplingIntervalMs': 2000, 'source': {'revision': REV, 'firstMs': first, 'lastMs': cutoff, 'missingIntervals': []}, 'tasks': tasks, 'originals': originals})
    save(output / 'prepared.json', {'originals': len(originals), 'tasks': len(tasks), 'sourceListingSha256': hashlib.sha256(listing.read_bytes()).hexdigest(), 'sourceQASha256': hashlib.sha256(audit.QA.read_bytes()).hexdigest(), 'inputSha256': hashlib.sha256((output / 'native-input.json').read_bytes()).hexdigest(), 'paidCalls': 0})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--listing', type=Path, default=ROOT / 'run/egolife-native-rgb-preflight-v1/source-listing.json')
    parser.add_argument('--authorize-public-video-download-and-qwen-upload', action='store_true')
    parser.add_argument('--resume-verified-downloads', action='store_true')
    parser.add_argument('--prepare-verified-only', action='store_true', help='Decode an already complete hash-verified download; never access the network')
    args = parser.parse_args()
    prepare(args.output, args.listing, args.authorize_public_video_download_and_qwen_upload, args.resume_verified_downloads, args.prepare_verified_only)

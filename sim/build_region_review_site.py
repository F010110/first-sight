"""Local static video/query review site. Human edits exported, never overwrite AI."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def make_payload(windows, report, review=None):
    ids = sorted(report['finalAssignments'], key=lambda id: int(id.removeprefix('observation-')))
    if len(ids) != len(windows):
        raise ValueError('Report/window inventory mismatch')
    if ids != [f'observation-{i}' for i in range(1, len(windows) + 1)]:
        raise ValueError('Require simulator replay observation IDs; no positional guess')
    labels = {row['observationId']: row for row in (review or {}).get('labels', [])}
    boundaries = {id: row for row in report.get('boundaryGroups', []) for id in row['observationIds']}
    samples = []
    for id, window in zip(ids, windows):
        if not isinstance(window['endTick'], int) or samples and window['endTick'] <= samples[-1]['tick']:
            raise ValueError('Unordered sample ticks')
        group = report['finalAssignments'][id]
        samples.append({'id': id, 'tick': window['endTick'], 'prediction': group, 'boundary': boundaries.get(id), 'aiReview': labels.get(id), 'image': f'images/{id}.jpg'})
    return {'protocol': 'region-human-review-site-v1', 'model': report.get('modelReturned'), 'samples': samples, 'protocolWarning': report.get('protocolError'), 'quarantinedGroups': report.get('quarantinedGroups', [])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset', type=Path); parser.add_argument('report', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--labels', type=Path); parser.add_argument('--fps', type=float, default=2)
    args = parser.parse_args()
    if not 0 < args.fps <= 60:
        raise ValueError('Invalid display fps')
    read = lambda p: json.loads(p.read_text(encoding='utf-8'))
    windows = [json.loads(line) for line in (args.dataset / 'windows.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    report = read(args.report); payload = make_payload(windows, report, read(args.labels) if args.labels else None)
    import imageio_ffmpeg
    frames = sorted((args.dataset / 'triple').glob('*.jpg'))
    numbers = [int(path.stem) for path in frames]
    if not frames or numbers != list(range(numbers[0], numbers[-1] + 1)) or numbers[0] != 0 or any(sample['tick'] > numbers[-1] for sample in payload['samples']):
        raise ValueError('Require contiguous recorded triple frames starting at zero')
    args.output.mkdir(parents=True, exist_ok=False); (args.output / 'images').mkdir()
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-framerate', str(args.fps), '-start_number', '0', '-i', str(args.dataset / 'triple' / '%04d.jpg'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(args.output / 'motion.mp4')], check=True, capture_output=True)
    for sample, window in zip(payload['samples'], windows):
        source = args.dataset / 'triple' / Path(window['frame']).name
        sample['imageSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        shutil.copyfile(source, args.output / sample['image'])
    payload.update({'fps': args.fps, 'frameCount': len(frames), 'reportSha256': hashlib.sha256(args.report.read_bytes()).hexdigest(), 'datasetId': args.dataset.name, 'regionReasons': report.get('answer', {}).get('regions', []), 'reviewScope': 'AI suggestions visible; assisted human review, NOT blind independent labels. Playback fps is presentation speed, not real capture time.'})
    (args.output / 'data.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    template = Path(__file__).with_name('region_review_site.html').read_text(encoding='utf-8')
    (args.output / 'index.html').write_text(template, encoding='utf-8')
    print(json.dumps({'site': str(args.output), 'samples': len(payload['samples']), 'frames': len(frames)}))


if __name__ == '__main__':
    main()

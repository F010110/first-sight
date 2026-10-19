"""Local static video/query review site. Human edits exported, never overwrite AI."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def display_triptych(image, gap=24):
    """Separate recorded left/front/right panels; never alter inference images."""
    import numpy as np
    height, width = image.shape[:2]
    if width % 3:
        raise ValueError('Triptych width must divide into three equal views')
    panels = np.split(image, 3, axis=1)
    spacer = np.full((height, gap, 3), 24, dtype=image.dtype)
    return np.concatenate([panels[0], spacer, panels[1], spacer, panels[2]], axis=1)


def export_display_video(frames, output, fps, subdivisions=12):
    """24fps frame holds; no blending or invented motion."""
    import cv2
    import imageio_ffmpeg
    first = display_triptych(cv2.imread(str(frames[0])))
    height, width = first.shape[:2]
    writer = imageio_ffmpeg.write_frames(str(output), (width, height), fps=fps * subdivisions, codec='libx264', pix_fmt_out='yuv420p', output_params=['-crf', '18', '-g', '24', '-movflags', '+faststart'])
    writer.send(None)
    try:
        for index, path in enumerate(frames):
            current = display_triptych(cv2.imread(str(path)))
            for step in range(subdivisions):
                writer.send(cv2.cvtColor(current, cv2.COLOR_BGR2RGB))
    finally:
        writer.close()


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
    parser.add_argument('--dense-video', type=Path, help='Actual rendered 24fps intermediate poses, never frame holds')
    parser.add_argument('--dataset-id', help='Stable unique scene identifier for catalog and review storage')
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
    if args.dense_video:
        shutil.copy2(args.dense_video, args.output / 'motion-hold.mp4')
    else:
        export_display_video(frames, args.output / 'motion-hold.mp4', args.fps)
    for sample, window in zip(payload['samples'], windows):
        source = args.dataset / 'triple' / Path(window['frame']).name
        sample['imageSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        import cv2
        cv2.imwrite(str(args.output / sample['image']), display_triptych(cv2.imread(str(source))))
    payload.update({'fps': args.fps, 'frameCount': len(frames), 'reportSha256': hashlib.sha256(args.report.read_bytes()).hexdigest(), 'datasetId': args.dataset.name, 'regionReasons': report.get('answer', {}).get('regions', []), 'reviewScope': 'AI suggestions visible; assisted human review, NOT blind independent labels. Playback fps is presentation speed, not real capture time.'})
    if args.dataset_id:
        payload['datasetId'] = args.dataset_id
    payload['displayInterpolation'] = {'method': 'frame-hold', 'subdivisions': 12, 'outputFps': args.fps * 12, 'syntheticDisplayOnly': True, 'viewGapPixels': 24}
    if args.dense_video:
        payload['displayInterpolation'] = {'method': 'actual-action-rerender', 'outputFps': 24, 'syntheticDisplayOnly': False, 'viewGapPixels': 24, 'videoSha256': hashlib.sha256(args.dense_video.read_bytes()).hexdigest()}
        payload['reviewScope'] = 'AI prelabels and predictions are separate outputs; assisted human review, not independent ground truth. Dense video renders actual intermediate action positions at 24fps.'
    (args.output / 'data.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    template = Path(__file__).with_name('region_review_site.html').read_text(encoding='utf-8')
    if args.dense_video:
        template = template.replace('24fps重复原帧，无淡化；原素材2帧/秒，不代表新增转动细节。', '24fps真实小步动作逐帧渲染，无重复帧平滑或淡化；原观察素材2帧/秒。')
    capture_manifest = args.dataset / 'manifest.json'
    if capture_manifest.exists():
        source = read(capture_manifest)
        if source.get('protocol') == 'hssd-action-capture-v1':
            payload['attribution'] = {'dataset': 'Habitat Synthetic Scenes Dataset (HSSD)', 'authors': 'Mukul Khanna et al.', 'source': source['source'], 'license': source['license'], 'licenseUrl': 'https://creativecommons.org/licenses/by-nc/4.0/', 'revision': source['revision'], 'changes': 'Rendered camera views, action tour, review video, image-only AI suggestions.'}
            (args.output / 'data.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
            template = template.replace('</header>', '</header><span class="muted">素材：HSSD · Khanna等；<a href="https://3dlg-hcvc.github.io/hssd/">来源</a> · <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>；衍生渲染/视频/AI建议，仅非商业审核。</span>', 1)
    (args.output / 'index.html').write_text(template, encoding='utf-8')
    print(json.dumps({'site': str(args.output), 'samples': len(payload['samples']), 'frames': len(frames)}))


if __name__ == '__main__':
    main()

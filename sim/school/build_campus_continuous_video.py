"""Native 10fps campus RGB playback, isolated from 0.5fps model evidence."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def build(replay, provenance, sources, output, ffmpeg):
    from PIL import Image
    rows = [json.loads(line) for line in replay.read_text(encoding='utf8').splitlines() if line.strip()]
    # Private source provenance is used ONLY by this display builder. No pose,
    # world label or frame index is sent to either runtime Agent.
    truth = {row['observationId']: row for row in map(json.loads, provenance.read_text(encoding='utf8').splitlines())}
    groups = {}
    for row in rows:
        groups.setdefault(row['episodeNumber'], []).append(row)
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'schema': 'campus-native-video-v1', 'fps': 10, 'modelFps': .5,
                'replaySha256': sha(replay), 'modelCalls': 0, 'episodes': [],
                'method': 'Original native 10Hz RGB frames, resized into a triptych. No duplicate-frame upsampling, optical flow, pose interpolation or new view synthesis. Display ONLY; never Agent evidence. Episode gaps are not invented.'}
    (output / 'SOURCE-NOTICE.md').write_text('TartanGround (2025), theairlabcmu/TartanGround, revision 388faf9c800568cfc6828fa47e063f8369397eb3; CC BY 4.0. Native RGB resized and composed as left/front/right display video.\n', encoding='utf8')
    try:
        for episode, samples in groups.items():
            source_ids = {truth[row['id']]['sourceFrameUid'].split('/')[2] for row in samples}
            if len(source_ids) != 1:
                raise ValueError('Episode crosses native trajectories')
            trajectory = next(iter(source_ids))
            folder = sources / 'AbandonedSchool' / 'Data_omni' / trajectory
            archives = {view: zipfile.ZipFile(folder / f'image_lcam_{view}.zip') for view in ['left', 'front', 'right']}
            process = None
            try:
                entries = {view: {int(Path(name).name.split('_')[0]): name for name in archive.namelist() if name.endswith('.png')} for view, archive in archives.items()}
                keys = sorted(entries['front'])
                if not keys or keys != list(range(len(keys))) or any(sorted(entries[view]) != keys for view in entries):
                    raise ValueError('Native frame indices missing or inconsistent')
                for row in samples:
                    index = truth[row['id']]['sourceFrameIndex']
                    if abs(index * 100 - row['sourceAtMs']) > 1:
                        raise ValueError('Native source clock mismatch')
                    for view in entries:
                        raw = archives[view].read(entries[view][index])
                        if hashlib.sha256(raw).hexdigest() != row['sha256'][view]:
                            raise ValueError('Native source differs from model sample')
                target = output / f'episode-{episode:02d}.mp4'
                command = [str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1280x640', '-r', '10', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)]
                with (output / f'episode-{episode:02d}.stderr.log').open('wb') as errors:
                    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=errors)
                    import io
                    for index in keys:
                        canvas = Image.new('RGB', (1280, 640), '#15201d')
                        for view, x, size in [('left', 0, 320), ('front', 320, 640), ('right', 960, 320)]:
                            with Image.open(io.BytesIO(archives[view].read(entries[view][index]))) as image:
                                image = image.convert('RGB')
                                image.thumbnail((size, size), Image.Resampling.BILINEAR)
                                canvas.paste(image, (x + (size - image.width) // 2, (640 - image.height) // 2))
                        process.stdin.write(canvas.tobytes())
                    process.stdin.close()
                    if process.wait() != 0:
                        raise RuntimeError('ffmpeg failed; stderr retained')
                manifest['episodes'].append({'episodeNumber': episode, 'src': target.name,
                                             'sourceScheduleStartMs': samples[0]['atMs'] - samples[0]['sourceAtMs'],
                                             'frames': len(keys), 'durationSeconds': len(keys) / 10,
                                             'sha256': sha(target)})
                (output / 'progress.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
                print(f'Episode {episode}: {len(keys)} actual frames / {len(keys)/10:.1f}s', flush=True)
            finally:
                if process and process.poll() is None:
                    process.kill()
                    process.wait()
                for archive in archives.values():
                    archive.close()
        (output / 'complete.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
    except BaseException as error:
        (output / 'stopped.json').write_text(json.dumps({'error': str(error), 'completedEpisodes': len(manifest['episodes'])}), encoding='utf8')
        raise


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--replay', type=Path, default=Path('run/inspect-repair-full90-v1/model-replay/observations.jsonl'))
    p.add_argument('--provenance', type=Path, default=Path('D:/Datasets/activity-benchmark-v1/school-offline-v1/school-rounds/evaluation-only/source-truth.jsonl'))
    p.add_argument('--sources', type=Path, default=Path('D:/Datasets/activity-benchmark-v1/rgb-sources-v1'))
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--ffmpeg', type=Path)
    a = p.parse_args()
    if not a.ffmpeg:
        import imageio_ffmpeg
        a.ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
    build(a.replay, a.provenance, a.sources, a.output, a.ffmpeg)

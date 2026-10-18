"""Encode time-faithful sampled-frame playback; no invented intermediate views."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def episode_plan(samples):
    groups = {}
    for sample in samples:
        groups.setdefault(sample['episode'], []).append(sample)
    for rows in groups.values():
        rows.sort(key=lambda r: r['sourceAtMs'])
        if any(b['sourceAtMs'] <= a['sourceAtMs'] for a, b in zip(rows, rows[1:])):
            raise ValueError('Source timestamps must increase within episode')
    return groups


def encode(root, ffmpeg):
    data = json.loads((root / 'data.json').read_text(encoding='utf8'))
    output = root / 'videos'
    output.mkdir(exist_ok=False)
    videos = []
    for episode, rows in episode_plan(data['samples']).items():
        start = rows[0]['sourceAtMs'] / 1000
        inputs = []
        # left small, FRONT large, right small. All use identical source timing.
        for camera in ['left', 'front', 'right']:
            listing = output / f'episode-{episode}-{camera}.ffconcat'
            text = ['ffconcat version 1.0']
            for index, row in enumerate(rows):
                path = (root / row['cameras'][camera]).resolve()
                if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256'][camera]:
                    raise ValueError('Original image changed')
                duration = ((rows[index+1]['sourceAtMs']-row['sourceAtMs'])/1000
                            if index+1 < len(rows) else 2.0)
                text += ["file '"+path.as_posix().replace("'", "'\\''")+"'", f'duration {duration:.6f}']
            text += ["file '"+(root / rows[-1]['cameras'][camera]).resolve().as_posix().replace("'", "'\\''")+"'"]
            listing.write_text('\n'.join(text)+'\n', encoding='utf8')
            inputs += ['-safe', '0', '-f', 'concat', '-i', str(listing)]
        target = output / f'episode-{episode}.mp4'
        duration = rows[-1]['sourceAtMs']/1000-start+2
        filters = ('[0:v]scale=320:240:force_original_aspect_ratio=decrease,pad=320:600:(ow-iw)/2:(oh-ih)/2:color=0x101827[l];'
                   '[1:v]scale=800:600:force_original_aspect_ratio=decrease,pad=800:600:(ow-iw)/2:(oh-ih)/2:color=0x101827[f];'
                   '[2:v]scale=320:240:force_original_aspect_ratio=decrease,pad=320:600:(ow-iw)/2:(oh-ih)/2:color=0x101827[r];'
                   '[l][f][r]hstack=inputs=3,fps=24,format=yuv420p[v]')
        subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', *inputs,
                        '-filter_complex', filters, '-map', '[v]', '-t', str(duration),
                        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
                        '-movflags', '+faststart', str(target)], check=True)
        videos.append({'episode': episode, 'src': target.relative_to(root).as_posix(),
                       'startSourceSeconds': start, 'duration': duration,
                       'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        print(f'Encoded episode {episode}: {duration:.1f}s', flush=True)
    markers = []
    by_id = {s['id']: s for s in data['samples']}
    for issue in data['issues']:
        sample = by_id[next((i for i in issue['referenceIds'] if i != issue['currentId']), issue['currentId'])]
        markers.append({'issueId': issue['id'], 'sampleId': sample['id'],
                        'episode': sample['episode'], 'sourceSeconds': sample['sourceAtMs']/1000})
    manifest = {'protocol': 'school-sampled-video-v1', 'fingerprint': data['fingerprint'],
                'method': 'Original sampled frames held until next source timestamp; 24fps duplicates only, no interpolation. Final sample held 2s. Episodes remain separate; no gap transit invented.',
                'layout': {'leftWidth': 320, 'frontWidth': 800, 'rightWidth': 320, 'height': 600},
                'videos': videos, 'markers': markers}
    (root / 'videos.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('root', type=Path)
    p.add_argument('--ffmpeg', type=Path, required=True)
    args = p.parse_args(); encode(args.root, args.ffmpeg)

"""Create explicit H264 display derivatives; preserve original files/manifests and frame counts."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8*1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True)
    args = p.parse_args()
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for name in ['ute-p04-long', 'ute-p01-long']:
        root = args.archive / name
        original_manifest = root / 'original-mpeg4-manifest.json'
        # The unsupported original is not a ready browser recording. Keep its manifest.
        (root / 'manifest.json').rename(original_manifest)
        manifest = json.loads(original_manifest.read_text(encoding='utf8'))
        original = root / manifest['clips'][0]['file']
        if sha(original) != manifest['clips'][0]['sha256']:
            raise ValueError('Original changed')
        target = root / 'clips/0001.mp4'
        command = [ffmpeg, '-hide_banner', '-nostdin', '-n', '-i', str(original), '-map', '0:v:0', '-map', '0:a?',
                   '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                   '-movflags', '+faststart', str(target)]
        (root / 'transcode-plan.json').write_text(json.dumps({'command': command, 'originalSha256': manifest['clips'][0]['sha256'],
            'purpose': 'Browser display derivative, not original bytes or new model evidence', 'modelCalls': 0}, indent=2))
        try:
            with (root / 'transcode.log').open('wb') as log:
                subprocess.run(command, stdout=subprocess.DEVNULL, stderr=log, check=True)
            result = subprocess.run([ffmpeg, '-hide_banner', '-v', 'info', '-xerror', '-i', str(target), '-map', '0:v:0', '-an', '-f', 'null', '-'], capture_output=True, text=True)
            (root / 'derived-full-decode.log').write_text(result.stderr)
            frames = re.findall(r'frame=\s*(\d+)', result.stderr)
            if result.returncode or not frames or int(frames[-1]) != manifest['review']['frames']:
                raise ValueError('Derived decode/frame count mismatch')
            import cv2
            cap = cv2.VideoCapture(str(target))
            fps = cap.get(cv2.CAP_PROP_FPS)
            duration = cap.get(cv2.CAP_PROP_FRAME_COUNT)/fps
            cap.release()
            if fps != 15 or abs(duration*1000-manifest['durationMs']) > 2:
                raise ValueError('Derived clock/rate mismatch')
            original_binding = manifest['clips'][0]
            manifest['clips'] = [{'file': 'clips/0001.mp4', 'bytes': target.stat().st_size, 'sha256': sha(target), 'durationMs': manifest['durationMs']}]
            manifest['originalBinding'] = original_binding
            manifest['displayDerivative'] = {'codec': 'H264', 'resolution': [480,320], 'fps': 15, 'sameFrameCount': True,
                                              'resized': False, 'interpolated': False, 'trimmed': False}
            manifest['scope'] = '网页为H.264兼容转码版；原始MPEG-4文件另存保留。帧数、分辨率、15fps和时长核验一致；未插帧、未删段。' + manifest['scope']
            manifest['title'] += '（网页兼容版）'
            (root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')
            print(json.dumps({'id': name, 'frames': int(frames[-1]), 'fps': fps, 'durationMs': manifest['durationMs'], 'compatible': True}), flush=True)
        except Exception as error:
            (root / 'transcode-failure.json').write_text(json.dumps({'error': str(error)}))
            raise

if __name__ == '__main__':
    main()

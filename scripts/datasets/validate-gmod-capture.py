"""Read-only image/pose preflight. Structural checks never certify world synchronization."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageStat

DIRECTIONS = ('front', 'left', 'right')

def rotation(pose):
    r = np.asarray(pose['rotation_world_from_flu'], dtype=float)
    if r.shape != (3, 3) or not np.isfinite(r).all() or not np.allclose(r.T @ r, np.eye(3), atol=1e-5) or not math.isclose(np.linalg.det(r), 1, abs_tol=1e-5):
        raise ValueError('Invalid right-handed rotation matrix')
    return r

def safe_image(root, relative):
    if not isinstance(relative, str) or '\\' in relative or ':' in relative:
        raise ValueError('Unsafe image path')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe image path')
    result = (root / path).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('Image escapes episode')
    return result

def validate(root, minimum=30):
    metadata = json.loads((root / 'metadata.json').read_text(encoding='utf8'))
    if metadata.get('schema') != 'first-sight-gmod-pilot-v1':
        raise ValueError('Unsupported episode schema')
    trajectory = root / 'trajectory.jsonl'
    if not trajectory.exists():
        trajectory = root / 'trajectory.jsonl.txt'
    if trajectory.stat().st_size > 8_000_000:
        raise ValueError('Trajectory exceeds bounded pilot size')
    rows = [json.loads(line) for line in trajectory.read_text(encoding='utf8').splitlines() if line.strip()]
    errors, images, intervals = [], [], []
    maximum = metadata.get('max_samples', 30)
    if not isinstance(maximum, int) or not 1 <= maximum <= 1200:
        raise ValueError('Invalid bounded maximum sample count')
    if not minimum <= len(rows) <= maximum:
        errors.append(f'Expected {minimum}..{maximum} committed samples, got {len(rows)}')
    previous, rig = None, None
    seen = set()
    for index, row in enumerate(rows, 1):
        try:
            if row['sample_id'] != index:
                raise ValueError('Non-contiguous sample IDs')
            t = float(row['sim_time_s'])
            if not math.isfinite(t) or (previous is not None and t <= previous):
                raise ValueError('Non-monotonic simulation time')
            if previous is not None:
                intervals.append(t-previous)
            previous = t
            hr = rotation(row['head'])
            hp = np.asarray(row['head']['position_m'], dtype=float)
            if hp.shape != (3,) or not np.isfinite(hp).all():
                raise ValueError('Invalid head position')
            if not row.get('same_frame_tick_time'):
                raise ValueError('Capture callback frame/tick/time advanced')
            current_rig, hashes = {}, []
            for direction in DIRECTIONS:
                camera = row['cameras'][direction]
                cr = rotation(camera['pose'])
                cp = np.asarray(camera['pose']['position_m'], dtype=float)
                if cp.shape != (3,) or not np.isfinite(cp).all():
                    raise ValueError('Invalid camera position')
                current_rig[direction] = (hr.T @ (cp-hp), hr.T @ cr)
                before, after = camera['before'], camera['after']
                for key, expected in [('frame', row['frame']), ('tick', row['tick']), ('sim_time_s', t)]:
                    if before[key] != expected or after[key] != expected:
                        raise ValueError('Per-camera frame/tick/time differs')
                path = safe_image(root, camera['path'])
                if path in seen:
                    raise ValueError('Reused image path')
                seen.add(path)
                if not 0 < path.stat().st_size <= 2 * 1024 * 1024:
                    raise ValueError('Image size exceeds pilot cap')
                raw = path.read_bytes()
                if len(raw) != camera['bytes']:
                    raise ValueError('Image byte count mismatch')
                digest = hashlib.sha256(raw).hexdigest()
                hashes.append(digest)
                with Image.open(path) as image:
                    image.load()
                    expected_format = 'JPEG' if metadata.get('capture_format') == 'jpeg' else 'PNG'
                    if image.format != expected_format or image.size != (640, 480):
                        raise ValueError(f'Expected 640x480 {expected_format}')
                    rgb = image.convert('RGB')
                    extrema = rgb.getextrema()
                    if max(high for low, high in extrema) <= 2:
                        raise ValueError('Black image')
                    if max(ImageStat.Stat(rgb).stddev) < 0.1:
                        raise ValueError('Uniform image; inspect capture failure')
                images.append({'sample_id': index, 'direction': direction, 'sha256': digest})
            if len(set(hashes)) != 3:
                raise ValueError('Duplicate view images')
            expected_forward = {'front': [1, 0, 0], 'left': [0, 1, 0], 'right': [0, -1, 0]}
            for name, (_, r) in current_rig.items():
                if not np.allclose(r[:, 0], expected_forward[name], atol=1e-4):
                    raise ValueError('Front/left/right direction convention incorrect')
            if rig is not None:
                for name in DIRECTIONS:
                    if not all(np.allclose(a, b, atol=1e-4) for a, b in zip(rig[name], current_rig[name])):
                        raise ValueError('Rig extrinsics changed across samples')
            rig = current_rig
        except (KeyError, ValueError, OSError) as error:
            errors.append({'sample': index, 'error': str(error)})
    interval = metadata.get('interval_sim_s', 2.)
    if not isinstance(interval, (int, float)) or not math.isfinite(interval) or interval <= 0:
        raise ValueError('Invalid sample interval')
    if intervals and any(delta < interval-.01 or delta > interval+.25 for delta in intervals):
        errors.append('Sampling interval outside configured tolerance; do not fill missing samples')
    return {'structural_checks_passed': not errors, 'samples': len(rows), 'images_checked': images,
            'intervals_sim_s': intervals, 'errors': errors, 'synchronization_verified': False,
            'runtime_visual_review_required': True, 'intrinsics_calibrated': metadata.get('intrinsics_calibrated', False),
            'metric_scale_calibrated': metadata.get('metric_scale_calibrated', False),
            'life_scenario_verified': False, 'final_dataset_accepted': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episode', type=Path)
    parser.add_argument('--minimum', type=int, choices=[1, 30], default=30)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = validate(args.episode, args.minimum)
    with args.output.open('x', encoding='utf8') as dest:
        json.dump(result, dest, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in result.items() if k != 'images_checked'}, ensure_ascii=False))
    raise SystemExit(0 if result['structural_checks_passed'] else 1)

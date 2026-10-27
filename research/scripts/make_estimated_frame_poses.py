"""Convert OpenVINS estimates at rendered-frame times back to Habitat camera poses.

Writes one directory for VIO-estimated poses and one for the GT poses of the same
frames, so the association comparison uses an identical frame subset.
"""
import argparse
import csv
import json
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]
ALIGN = np.array([[1., 0., 0.], [0., 0., -1.], [0., 1., 0.]])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--poses', type=Path, required=True)
    parser.add_argument('--frames', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True, help='openvins-on-render config dir (meta.json)')
    parser.add_argument('--out-vio', type=Path, required=True)
    parser.add_argument('--out-gt', type=Path, required=True)
    args = parser.parse_args()

    with args.poses.open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    t = np.array([float(r['t']) for r in rows])
    est_p = np.array([[float(r['est_p' + a]) for a in 'xyz'] for r in rows])
    est_q = np.array([[float(r['est_q' + a]) for a in 'xyzw'] for r in rows])

    meta = json.loads((args.config / 'meta.json').read_text())
    frame_times = np.array(meta['frameTimes'])
    render = json.loads((args.frames / 'render.json').read_text())

    # JPL q_GtoI -> Hamilton matrix gives body(camera)->world.
    est_r = Rotation.from_quat(est_q).as_matrix()
    gt_r_raw = np.array([np.array(f['cameraWorld'])[:3, :3] for f in render['frames']])
    gt_p_raw = np.array([np.array(f['cameraWorld'])[:3, 3] for f in render['frames']])

    args.out_vio.mkdir(parents=True, exist_ok=True)
    args.out_gt.mkdir(parents=True, exist_ok=True)
    covered, errors = [], []
    for k, ft in enumerate(frame_times):
        if ft < t[0] or ft > t[-1]:
            continue
        p = np.array([np.interp(ft, t, est_p[:, i]) for i in range(3)])
        # Nearest-sample rotation (10 Hz estimates; frame times are 0.8 s apart).
        idx = int(np.argmin(np.abs(t - ft)))
        r_est_zup = Rotation.from_quat(est_q[idx]).as_matrix()
        pose_est = np.eye(4)
        pose_est[:3, :3] = ALIGN.T @ r_est_zup
        pose_est[:3, 3] = ALIGN.T @ p
        pose_gt = np.eye(4)
        pose_gt[:3, :3] = gt_r_raw[k]
        pose_gt[:3, 3] = gt_p_raw[k]
        np.save(args.out_vio / f'{k:04d}.pose.npy', pose_est)
        np.save(args.out_gt / f'{k:04d}.pose.npy', pose_gt)
        covered.append(k)
        errors.append({'frame': k, 'time': float(ft),
                       'positionErrorM': float(np.linalg.norm(pose_est[:3, 3] - pose_gt[:3, 3])),
                       'orientationErrorDeg': float(np.rad2deg(Rotation.from_matrix(
                           pose_est[:3, :3].T @ pose_gt[:3, :3]).magnitude()))})
    msg = {'poses': str(args.poses), 'frames': str(args.frames), 'coveredFrames': covered,
           'coverage': len(covered), 'totalFrames': len(frame_times), 'errors': errors,
           'meanPositionErrorM': float(np.mean([e['positionErrorM'] for e in errors])),
           'meanOrientationErrorDeg': float(np.mean([e['orientationErrorDeg'] for e in errors])),
           'note': 'Estimate convention verified only against GT at frame times; VIO visual input was synthetic features.'}
    (args.out_vio / 'coverage.json').write_text(json.dumps(msg, indent=2), encoding='utf-8')
    (args.out_gt / 'coverage.json').write_text(json.dumps(msg, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in msg.items() if k not in ('coveredFrames', 'errors')}, indent=2))


if __name__ == '__main__':
    main()

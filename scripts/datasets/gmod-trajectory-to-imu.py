"""Derive approximate IMU from REAL exported head poses; never resamples or fabricates a trajectory."""
import argparse
import csv
import json
from pathlib import Path
import numpy as np

def derive(rows, max_gap=.25, accel_noise=0., gyro_noise=0., seed=0):
    if len(rows) < 3:
        raise ValueError('At least three actual pose samples required')
    if min(accel_noise, gyro_noise) < 0 or max_gap <= 0:
        raise ValueError('Noise must be nonnegative and max-gap positive')
    t = np.asarray([r['sim_time_s'] for r in rows], dtype=float)
    p = np.asarray([r['head']['position_m'] for r in rows], dtype=float)
    rotations = np.asarray([r['head']['rotation_world_from_flu'] for r in rows], dtype=float)
    if p.shape != (len(rows), 3) or rotations.shape != (len(rows), 3, 3):
        raise ValueError('Invalid pose shapes')
    if not all(np.isfinite(v).all() for v in [t, p, rotations]):
        raise ValueError('Nonfinite trajectory')
    if np.any(np.diff(t) <= 0) or np.any(np.diff(t) > max_gap):
        raise ValueError('Repeated/reversed times or trajectory gap; no interpolation allowed')
    for r in rotations:
        if not np.allclose(r.T @ r, np.eye(3), atol=1e-5) or not np.isclose(np.linalg.det(r), 1, atol=1e-5):
            raise ValueError('Invalid right-handed rotation')
    acceleration = np.gradient(np.gradient(p, t, axis=0, edge_order=2), t, axis=0, edge_order=2)
    rng = np.random.default_rng(seed)
    output = []
    for i in range(1, len(rows)-1):
        delta = rotations[i+1] @ rotations[i-1].T
        theta = np.arccos(np.clip((np.trace(delta)-1)/2, -1, 1))
        if theta > np.pi - 1e-4:
            raise ValueError('Ambiguous near-180-degree rotation; sample poses more densely')
        skew = np.array([delta[2, 1]-delta[1, 2], delta[0, 2]-delta[2, 0], delta[1, 0]-delta[0, 1]])
        world_omega = skew * (.5 if theta < 1e-7 else theta/(2*np.sin(theta))) / (t[i+1]-t[i-1])
        ideal_gyro = rotations[i].T @ world_omega
        ideal_accel = rotations[i].T @ (acceleration[i] - np.array([0, 0, -9.80665]))
        output.append([t[i], *ideal_accel, *ideal_gyro,
                       *(ideal_accel+rng.normal(0, accel_noise, 3)), *(ideal_gyro+rng.normal(0, gyro_noise, 3))])
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trajectory', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--accel-noise', type=float, default=0.)
    parser.add_argument('--gyro-noise', type=float, default=0.)
    parser.add_argument('--seed', type=int, default=0)
    args = parser.parse_args()
    if args.trajectory.stat().st_size > 128_000_000:
        parser.error('Input exceeds bounded pilot size')
    rows = [json.loads(line) for line in args.trajectory.read_text(encoding='utf8').splitlines() if line.strip()]
    result = derive(rows, accel_noise=args.accel_noise, gyro_noise=args.gyro_noise, seed=args.seed)
    with args.output.open('x', newline='', encoding='utf8') as dest:
        writer = csv.writer(dest)
        writer.writerow(['sim_time_s', 'ideal_ax', 'ideal_ay', 'ideal_az', 'ideal_gx', 'ideal_gy', 'ideal_gz',
                         'measured_ax', 'measured_ay', 'measured_az', 'measured_gx', 'measured_gy', 'measured_gz'])
        writer.writerows(result)
    print('Approximate pose-derived specific force (m/s^2) and gyro (rad/s), FLU sensor frame. Not native IMU; no resampling. Scale must be calibrated separately.')

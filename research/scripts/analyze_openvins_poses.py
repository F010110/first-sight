"""Validate the research driver CSV and report unaligned same-frame errors."""
import argparse
import csv
import json
from pathlib import Path
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv', type=Path)
    args = parser.parse_args()
    with args.csv.open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) < 10:
        raise ValueError('Insufficient pose samples')
    def columns(names):
        return np.array([[float(row[name]) for name in names] for row in rows])
    times = columns(['t'])[:, 0]
    ep = columns(['est_px', 'est_py', 'est_pz'])
    gp = columns(['gt_px', 'gt_py', 'gt_pz'])
    eq = columns(['est_qx', 'est_qy', 'est_qz', 'est_qw'])
    gq = columns(['gt_qx', 'gt_qy', 'gt_qz', 'gt_qw'])
    if not np.isfinite(np.column_stack((times, ep, gp, eq, gq))).all():
        raise ValueError('Nonfinite states')
    if not (np.diff(times) > 0).all():
        raise ValueError('Duplicate/nonmonotonic timestamps')
    if not (np.allclose(np.linalg.norm(eq, axis=1), 1, atol=1e-3) and
            np.allclose(np.linalg.norm(gq, axis=1), 1, atol=1e-3)):
        raise ValueError('Quaternion norms invalid')
    error = np.linalg.norm(ep - gp, axis=1)
    angles = np.rad2deg(2 * np.arccos(np.clip(np.abs(np.sum(eq * gq, axis=1)), 0, 1)))
    report = {'source': str(args.csv), 'samples': len(rows),
              'durationS': float(times[-1] - times[0]),
              'positionRmseM': float(np.sqrt(np.mean(error ** 2))),
              'positionMaxM': float(error.max()), 'positionFinalM': float(error[-1]),
              'orientationMeanDeg': float(angles.mean()), 'orientationMaxDeg': float(angles.max()),
              'alignment': 'none; same GT-initialized frame, not aligned benchmark ATE',
              'scope': 'synthetic feature simulation / GT initialization; not Habitat RGB VIO, memory or task evaluation'}
    args.csv.with_suffix('.analysis.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

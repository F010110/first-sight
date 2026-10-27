"""Geometry/index diagnostic, NOT execution of 3D-Mem/GraphEQA/Meta-Memory."""
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def rotation(deg):
    a = np.deg2rad(deg)
    return np.array([[np.cos(a), -np.sin(a), 0],
                     [np.sin(a), np.cos(a), 0], [0, 0, 1]])


def main():
    rng = np.random.default_rng(20261025)
    rows = []
    # Same stationary rig observes fixed landmarks while turning. Local measurements
    # are exact; only second-observation rig pose is corrupted. Axes: z up.
    for distance in (2., 5., 10.):
        for yaw_error in (0., 2., 5., 10.):
            for drift in (0., .25, 1.):
                errors = []
                for _ in range(100):
                    yaw = rng.uniform(-180, 180)
                    landmark = np.array([distance, 0., 0.])
                    direction = rng.uniform(-np.pi, np.pi)
                    translation = drift * np.array([np.cos(direction), np.sin(direction), 0.])
                    # Three cameras share one erroneous rig pose. Exact extrinsics
                    # must cancel; extra cameras alone cannot remove common error.
                    per_camera = []
                    for offset in (0., 90., -90.):
                        local = rotation(yaw + offset).T @ landmark
                        reconstructed = rotation(yaw + yaw_error + offset) @ local + translation
                        per_camera.append(reconstructed)
                    errors.append([np.linalg.norm(per_camera[0] - landmark),
                                   np.linalg.norm(np.mean(per_camera, axis=0) - landmark)])
                errors = np.array(errors)
                rows.append({'rangeM': distance, 'yawErrorDeg': yaw_error, 'translationDriftM': drift,
                             'singleMeanErrorM': float(errors[:, 0].mean()),
                             'tripleMeanErrorM': float(errors[:, 1].mean())})
    # Position kNN toy diagnostic: stable observations at x=0,5,10,15.
    # Only remembered coordinate of the correct record drifts; query is fixed.
    knn = []
    for drift in (0., 1., 3., 5., 8.):
        positions = np.array([0., 5., 10. + drift, 15.])
        rank = np.argsort(np.abs(positions - 10.)).tolist().index(2) + 1
        knn.append({'correctRecordDriftM': drift, 'correctRecordRank': rank})
    report = {'scope': 'synthetic geometry and position-kNN diagnostic only; no upstream methods, VLM, VIO, raw IMU or benchmark episodes',
              'seed': 20261025, 'trialsPerCell': 100,
              'assumptions': 'exact depth, exact extrinsics, all cameras observe same landmark, common pose error; not a coverage experiment',
              'geometry': rows, 'positionKnnToy': knn}
    target = ROOT / 'reports/pose-sensitivity-diagnostic.json'
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(target)
    for row in rows:
        if row['rangeM'] == 5. and row['translationDriftM'] == 0.:
            print(row)
    assert max(abs(r['singleMeanErrorM'] - r['tripleMeanErrorM']) for r in rows) < 1e-10
    print('common-error single/triple equality check passed')


if __name__ == '__main__':
    main()

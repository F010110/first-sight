"""Build an OpenVINS input from the rendered ReplicaCAD camera motion.

Body frame == camera frame (identity camera-IMU extrinsics). This is a declared
simplification: no lever arm, and OpenVINS still uses synthetic visual features,
not the rendered RGB. The point is to obtain a VIO error profile on the same
physical camera path, then apply it to the real-image mapping pipeline.
"""
import json
import math
import argparse
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation, Slerp

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / 'runs/replicacad-views-v17-dense48'
DURATION = 60.0
RATE = 20.0

# Habitat/OpenGL world (y up, camera looks down -z) -> z-up estimator world.
ALIGN = np.array([[1., 0., 0.], [0., 0., -1.], [0., 1., 0.]])


def main():
    global DURATION
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'runs/openvins-on-render-v1'))
    parser.add_argument('--duration', type=float, default=60.0)
    parser.add_argument('--min-feature-dist', type=float, default=5.0)
    parser.add_argument('--max-feature-dist', type=float, default=7.0)
    args = parser.parse_args()
    OUT = Path(args.out)
    DURATION = args.duration
    OUT.mkdir(parents=True, exist_ok=True)
    render = json.loads((FRAMES / 'render.json').read_text())
    poses = [np.array(frame['cameraWorld'], dtype=float) for frame in render['frames']]
    n = len(poses)
    times = np.linspace(0., DURATION, n)
    positions = np.array([ALIGN @ p[:3, 3] for p in poses])
    rots = Rotation.from_matrix(np.array([ALIGN @ p[:3, :3] for p in poses]))
    # Interpolate; cubic for translation, SLERP for rotation.
    from scipy.interpolate import CubicSpline
    spline = CubicSpline(times, positions, axis=0)
    slerp = Slerp(times, rots)
    dense_t = np.arange(0., DURATION + 1e-9, 1. / RATE)
    lines = ['# timestamp tx ty tz qx qy qz qw (camera=IMU, z-up)']
    for t in dense_t:
        p = spline(t)
        q = slerp(t).as_quat()  # xyzw, camera->world
        lines.append(' '.join(f'{v:.12f}' for v in [t, *p, *q]))
    (OUT / 'trajectory.txt').write_text('\n'.join(lines) + '\n')

    # Camera model matches the rendered images.
    H, W, HFOV = 480, 640, 90.0
    fx = (W / 2.) / math.tan(math.radians(HFOV) / 2.)
    fy = fx
    cam_chain = f'''%YAML:1.0

cam0:
  T_imu_cam:
    - [1.0, 0.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0, 0.0]
    - [0.0, 0.0, 1.0, 0.0]
    - [0.0, 0.0, 0.0, 1.0]
  cam_overlaps: []
  camera_model: pinhole
  distortion_coeffs: [0.0, 0.0, 0.0, 0.0]
  distortion_model: radtan
  intrinsics: [{fx:.6f}, {fy:.6f}, {W/2:.6f}, {H/2:.6f}]
  resolution: [{W}, {H}]
  rostopic: /cam0/image_raw
'''
    (OUT / 'kalibr_imucam_chain.yaml').write_text(cam_chain)

    imu = (ROOT / 'runs/openvins-smoke-input/kalibr_imu_chain.yaml').read_text()
    (OUT / 'kalibr_imu_chain.yaml').write_text(imu)

    config = (ROOT / 'runs/openvins-smoke-input/estimator_config.yaml').read_text()
    replacements = {
        'use_stereo': 'false', 'max_cameras': '1',
        'calib_cam_extrinsics': 'false', 'calib_cam_intrinsics': 'false',
        'calib_cam_timeoffset': 'false', 'calib_imu_intrinsics': 'false',
        'calib_imu_g_sensitivity': 'false',
        'verbosity': '"WARNING"',
        'sim_traj_path': f'"{str(OUT / "trajectory.txt").replace(chr(92), "/")}"',
        'sim_freq_cam': '10', 'sim_freq_imu': '200',
        'sim_min_feature_gen_dist': f'{args.min_feature_dist}',
        'sim_max_feature_gen_dist': f'{args.max_feature_dist}',
        'init_window_time': '2.0',
    }
    for key, value in replacements.items():
        import re
        config = re.sub(rf'^{key}:.*$', f'{key}: {value}', config, flags=re.M)
    (OUT / 'estimator_config.yaml').write_text(config)

    meta = {'frames': n, 'durationS': DURATION, 'rateHz': RATE,
            'framesDir': str(FRAMES), 'frameTimes': times.tolist(),
            'bodyEqualsCamera': True, 'syntheticVisualFeatures': True,
            'featureGenDistM': [args.min_feature_dist, args.max_feature_dist],
            'camera': {'width': W, 'height': H, 'hfov': HFOV, 'fx': fx, 'fy': fy},
            'alignHabitatToZUp': ALIGN.tolist(),
            'note': 'OpenVINS visual input is synthetic features, NOT the rendered images'}
    (OUT / 'meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print('wrote', OUT)


if __name__ == '__main__':
    main()

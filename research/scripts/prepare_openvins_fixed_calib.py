"""Paired control: preserve trajectory/seeds/noise, disable online calibration."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'runs/openvins-noise-sweep-v1'
target = ROOT / 'runs/openvins-noise-fixed-calib-v1'
plan = json.loads((ROOT / 'reports/openvins-noise-sweep-v1-plan.json').read_text())
for case in plan['cases']:
    folder = target / case['name']
    folder.mkdir(parents=True, exist_ok=True)
    config = (source / case['name'] / 'estimator_config.yaml').read_text()
    for key in ('calib_cam_extrinsics', 'calib_cam_intrinsics', 'calib_cam_timeoffset',
                'calib_imu_intrinsics', 'calib_imu_g_sensitivity'):
        config = re.sub(rf'^{key}:.*$', f'{key}: false', config, flags=re.M)
    (folder / 'estimator_config.yaml').write_text(config, encoding='utf-8')
    for name in ('kalibr_imu_chain.yaml', 'kalibr_imucam_chain.yaml'):
        (folder / name).write_bytes((source / case['name'] / name).read_bytes())
plan['control'] = 'All five calibration estimation flags disabled; sim perturbation remains false. No claim about real calibration error.'
(ROOT / 'reports/openvins-noise-fixed-calib-v1-plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
print(target)

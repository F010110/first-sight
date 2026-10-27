"""Prepare a bounded synthetic OpenVINS smoke trajectory, not a benchmark scene."""
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def main():
    output = ROOT / 'runs/openvins-smoke-input'
    output.mkdir(parents=True, exist_ok=True)
    trajectory = output / 'trajectory.txt'
    lines = ['# timestamp tx ty tz qx qy qz qw; synthetic smooth smoke, not Habitat']
    for k in range(1201):
        t = k * .05
        angle = 2 * math.pi * t / 40
        x, y, z = 2 * math.sin(angle), 1 - math.cos(angle), .15 * math.sin(2 * angle)
        yaw = .5 * math.sin(angle)
        # Reader consumes pose-file xyzw; downstream spline conversion must be
        # checked before these poses are reused with any Habitat camera.
        values = [t, x, y, z, 0., 0., math.sin(yaw / 2), math.cos(yaw / 2)]
        lines.append(' '.join(f'{v:.12f}' for v in values))
    trajectory.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    upstream = ROOT / 'vendor/open-vins/config/rpng_sim'
    for name in ('kalibr_imu_chain.yaml', 'kalibr_imucam_chain.yaml'):
        (output / name).write_bytes((upstream / name).read_bytes())
    config = (upstream / 'estimator_config.yaml').read_text(encoding='utf-8')
    linux_path = '/mnt/' + str(trajectory.resolve()).replace('\\', '/')[0].lower() + str(trajectory.resolve()).replace('\\', '/')[2:]
    config = re.sub(r'^sim_traj_path:.*$', f'sim_traj_path: "{linux_path}"', config, flags=re.M)
    (output / 'estimator_config.yaml').write_text(config, encoding='utf-8')
    (ROOT / 'reports/openvins-smoke-input.json').write_text(json.dumps({
        'durationS': 60, 'controlPointIntervalS': .05, 'samples': 1201,
        'scope': 'upstream default simulation calibration/noise, no parameter sweep, no Habitat or 3D-Mem',
        'status': 'inputs generated; actual simulator run pending',
        'trajectory': str(trajectory), 'gtInitialization': True
    }, indent=2), encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()

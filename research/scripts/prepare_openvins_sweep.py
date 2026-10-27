"""Prepare paired, model-matched IMU noise scans. Not a memory benchmark."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / 'runs/openvins-smoke-input'
    output = ROOT / 'runs/openvins-noise-sweep-v1'
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'scope': 'OpenVINS synthetic features, GT initialization, default calibration estimation; no RGB or memory method',
                'noiseModel': 'simulation and estimator both receive scaled IMU densities (matched); NOT unknown bias/calibration robustness',
                'reference': 'upstream rpng_sim IMU densities', 'cases': []}
    keys = ['accelerometer_noise_density', 'accelerometer_random_walk',
            'gyroscope_noise_density', 'gyroscope_random_walk']
    # Fixed in advance; this is an engineering pilot, not statistical significance.
    for scale in (.5, 1., 1.25):
        for seed in (0, 1, 2):
            name = f'scale-{scale:g}-seed-{seed}'
            folder = output / name
            folder.mkdir(exist_ok=True)
            config = (source / 'estimator_config.yaml').read_text(encoding='utf-8')
            for key, value in [('sim_seed_measurements', seed), ('verbosity', '"WARNING"')]:
                config = re.sub(rf'^{key}:.*$', f'{key}: {value}', config, flags=re.M)
            (folder / 'estimator_config.yaml').write_text(config, encoding='utf-8')
            imu = (source / 'kalibr_imu_chain.yaml').read_text(encoding='utf-8')
            values = {}
            for key in keys:
                pattern = rf'({key}:\s*)([0-9.eE+-]+)'
                original = float(re.search(pattern, imu).group(2))
                values[key] = original * scale
                imu = re.sub(pattern, lambda m: m.group(1) + f'{values[key]:.9e}', imu)
            (folder / 'kalibr_imu_chain.yaml').write_text(imu, encoding='utf-8')
            (folder / 'kalibr_imucam_chain.yaml').write_bytes((source / 'kalibr_imucam_chain.yaml').read_bytes())
            manifest['cases'].append({'name': name, 'scale': scale, 'measurementSeed': seed,
                                      'densities': values,
                                      'configSha256': hashlib.sha256(config.encode()).hexdigest()})
    (ROOT / 'reports/openvins-noise-sweep-v1-plan.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Prepared', len(manifest['cases']), 'cases in', output)


if __name__ == '__main__':
    main()

"""Read-only dependency probe; all outputs confined to this workspace."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'platform': platform.platform(), 'python': sys.version,
              'executable': sys.executable, 'disk': dict(zip(('total', 'used', 'free'), shutil.disk_usage(ROOT))),
              'modules': {}, 'commands': {}}
    for module in ('habitat_sim', 'habitat', 'habitat_baselines', 'torch', 'hydra',
                   'omegaconf', 'numpy', 'PIL', 'open_clip', 'ultralytics', 'open3d',
                   'pytorch3d', 'langchain', 'langgraph', 'pymilvus', 'sentence_transformers', 'spark_dsg'):
        try:
            spec = importlib.util.find_spec(module)
            report['modules'][module] = {'available': spec is not None,
                                          'origin': spec.origin if spec else None}
        except (ImportError, ValueError) as error:
            report['modules'][module] = {'available': False, 'error': str(error)}
    for name, args in {
        'gpu': ['nvidia-smi', '--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
        'pip': [sys.executable, '-m', 'pip', 'list', '--format=json'],
    }.items():
        try:
            p = subprocess.run(args, capture_output=True, text=True, timeout=30)
            report['commands'][name] = {'returncode': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
        except (OSError, subprocess.TimeoutExpired) as error:
            report['commands'][name] = {'error': str(error)}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = ROOT / 'reports' / f'environment-{platform.system().lower()}-{stamp}.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(target)
    print(json.dumps({k: v['available'] for k, v in report['modules'].items()}, indent=2))


if __name__ == '__main__':
    main()

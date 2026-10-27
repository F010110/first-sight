"""Collect completed paired pilot results without interpreting as task scores."""
import json
from pathlib import Path
import statistics
import argparse

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', choices=['openvins-noise-sweep-v1', 'openvins-noise-fixed-calib-v1'], default='openvins-noise-sweep-v1')
    suite = parser.parse_args().suite
    plan = json.loads((ROOT / f'reports/{suite}-plan.json').read_text())
    cases = []
    for case in plan['cases']:
        path = ROOT / 'runs' / suite / case['name'] / 'poses.analysis.json'
        row = dict(case)
        row['result'] = json.loads(path.read_text()) if path.exists() else None
        cases.append(row)
    summary = []
    for scale in (.5, 1., 1.25):
        rows = [c['result'] for c in cases if c['scale'] == scale and c['result']]
        summary.append({'scale': scale, 'completed': len(rows),
                        'meanRmseM': statistics.mean(r['positionRmseM'] for r in rows) if rows else None,
                        'meanOrientationDeg': statistics.mean(r['orientationMeanDeg'] for r in rows) if rows else None})
    report = {'scope': plan['scope'], 'noiseModel': plan['noiseModel'], 'cases': cases, 'summary': summary,
              'caution': 'Three seeds, one synthetic trajectory; no significance or monotonicity claim; not memory task results'}
    report['control'] = plan.get('control')
    (ROOT / f'reports/{suite}-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    for c in cases:
        r = c['result']
        print(c['name'], f"RMSE={r['positionRmseM']:.6f}m angle={r['orientationMeanDeg']:.6f}deg" if r else 'MISSING')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()

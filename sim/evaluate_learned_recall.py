"""Evaluator-only geometric proxy ranking. Never supplies poses/pairs to feature extractors."""
import argparse
import json
from pathlib import Path

def evaluate(source, features_path, output, exclusion_ms=30000, metric='cosine'):
    import numpy as np
    if output.exists(): raise FileExistsError(output)
    rows = [json.loads(line) for line in (source / 'observations.jsonl').read_text().splitlines()]
    records = [json.loads(line) for line in features_path.read_text().splitlines()]
    if len({r['id'] for r in records}) != len(records) or {r['id'] for r in records} != {r['id'] for r in rows}:
        raise ValueError('Feature IDs do not exactly match source')
    vectors = {}
    for record in records:
        v = np.asarray(record['features'], dtype=np.float32)
        if v.ndim != 2 or len(v) != 3 or not np.isfinite(v).all(): raise ValueError('Invalid features')
        norm = np.linalg.norm(v, axis=1, keepdims=True)
        if np.any(norm == 0): raise ValueError('Zero feature vector')
        vectors[record['id']] = v / norm if metric == 'cosine' else v
    def distance(a, b):
        d = 1 - np.clip(a @ b.T, -1, 1) if metric == 'cosine' else ((a[:, None, :] - b[None, :, :]) ** 2).mean(axis=2)
        return float((d.min(axis=1).mean() + d.min(axis=0).mean()) / 2)
    ranks = {}
    for current in rows:
        history = [r for r in rows if r['atMs'] < current['atMs'] - exclusion_ms]
        ordered = sorted(history, key=lambda r: (distance(vectors[current['id']], vectors[r['id']]), r['id']))
        ranks[current['sourceFrameIndex']] = {r['sourceFrameIndex']: i + 1 for i, r in enumerate(ordered)}
    pairs = json.loads((source / 'evaluation-only' / 'coverage.json').read_text())['geometricRevisitPairs']
    checks = [{**pair, 'rank': ranks[pair['laterFrame']].get(pair['earlierFrame'])} for pair in pairs]
    eligible = [p for p in checks if p['rank'] is not None]
    report = {'sourceObservations': len(rows), 'features': str(features_path), 'metric': metric, 'exclusionMs': exclusion_ms, 'proxyPairs': len(checks), 'eligiblePairs': len(eligible), 'proxyRecallAt1': sum(p['rank'] <= 1 for p in eligible) / len(eligible) if eligible else None, 'proxyRecallAt2': sum(p['rank'] <= 2 for p in eligible) / len(eligible) if eligible else None, 'checks': checks, 'roomAccuracyMeasured': False, 'limitations': 'Overlapping evaluator-only geometric pairs, not independent place labels. No held-out improvement or identity correctness established. Symmetric per-view nearest aggregation is our adapter, not a claimed official three-camera protocol.'}
    output.write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps({k: v for k, v in report.items() if k != 'checks'}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('source', type=Path); parser.add_argument('features', type=Path); parser.add_argument('output', type=Path); parser.add_argument('--metric', choices=['cosine','rgb-mse'], default='cosine'); args = parser.parse_args()
    evaluate(args.source, args.features, args.output, metric=args.metric)

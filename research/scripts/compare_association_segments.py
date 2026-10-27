"""ARI by frame segment for two association runs, to see whether drift drives the change."""
import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import adjusted_rand_score


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reference', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--condition', default='gt')
    parser.add_argument('--segments', default='8-27,28-46')
    args = parser.parse_args()
    ref = json.loads((args.reference / 'assignments.json').read_text())[args.condition]
    cand = json.loads((args.candidate / 'assignments.json').read_text())[args.condition]
    rows = []
    for seg in args.segments.split(','):
        lo, hi = (int(x) for x in seg.split('-'))
        keys = [k for k in sorted(set(ref) & set(cand)) if lo <= int(k.split(',')[0]) <= hi]
        a = np.array([ref[k] for k in keys])
        b = np.array([cand[k] for k in keys])
        rows.append({'segment': seg, 'detections': len(keys),
                     'ari': float(adjusted_rand_score(a, b)),
                     'refClusters': int(len(set(a))), 'candClusters': int(len(set(b))),
                     'refClustersSplit': int(sum(1 for g in set(a) if len(set(b[a == g])) > 1))})
    print(json.dumps(rows, indent=2))
    (args.candidate / 'compare_segments.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

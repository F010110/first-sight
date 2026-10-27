"""Compare two association runs (e.g. GT-pose reference vs VIO-pose) on shared detections."""
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
    args = parser.parse_args()
    ref = json.loads((args.reference / 'assignments.json').read_text())[args.condition]
    cand = json.loads((args.candidate / 'assignments.json').read_text())[args.condition]
    keys = sorted(set(ref) & set(cand))
    if not keys:
        raise ValueError('No shared detections')
    a = np.array([ref[k] for k in keys])
    b = np.array([cand[k] for k in keys])
    splits = sum(1 for g in set(a) if len(set(b[a == g])) > 1)
    merges = sum(1 for p in set(b) if len(set(a[b == p])) > 1)
    ref_report = json.loads((args.reference / 'association.json').read_text())
    cand_report = json.loads((args.candidate / 'association.json').read_text())
    out = {'reference': str(args.reference), 'candidate': str(args.candidate),
           'sharedDetections': len(keys),
           'referenceDetections': len(ref), 'candidateDetections': len(cand),
           'referenceMapObjects': ref_report['metrics'][args.condition]['mapObjects'],
           'candidateMapObjects': cand_report['metrics'][args.condition]['mapObjects'],
           'ari': float(adjusted_rand_score(a, b)),
           'referenceClustersSplit': int(splits), 'candidateClustersMerged': int(merges),
           'referenceFrames': ref_report.get('frameIndices'),
           'candidatePoseDir': cand_report.get('poseDir'),
           'referencePoseDir': ref_report.get('poseDir'),
           'note': 'Partition comparison only; no task/QA score.'}
    target = args.candidate / 'compare_vs_reference.json'
    target.write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()

"""Read-only cross-visit identity diagnostic; no model calls or label changes."""
import argparse
import collections
import hashlib
import itertools
import json
from pathlib import Path


def score(bundle):
    predictions = {}
    for state in bundle['states']:
        for observation in state['memberIds']:
            if observation in predictions:
                raise ValueError('Duplicate observation membership')
            predictions[observation] = state['assessment']['location'].get('placeId')
    visits = {}
    for row in bundle['reference']:
        a = row['annotation']
        visit = visits.setdefault(a['segmentId'], {'segmentId': a['segmentId'], 'referencePlace': a['placeId'], 'ids': [], 'excludedBoundary': 0})
        if visit['referencePlace'] != a['placeId']:
            raise ValueError('Mixed reference visit')
        if a.get('boundaryUncertain'):
            visit['excludedBoundary'] += 1
        else:
            visit['ids'].append(row['id'])
    for visit in visits.values():
        counts = collections.Counter(predictions.get(i) for i in visit['ids'])
        counts.pop(None, None)
        best = counts.most_common(1)
        visit['predictedPlace'] = best[0][0] if best and best[0][1] > len(visit['ids']) / 2 else None
        visit['placeCounts'] = dict(counts)
    pairs = []
    observation_counts = collections.Counter()
    ordered = list(visits.values())
    for (i, a), (j, b) in itertools.combinations(enumerate(ordered), 2):
        if j == i + 1:
            continue  # Adjacent visits are transitions, not revisit trials.
        if not a['ids'] or not b['ids']:
            continue
        actual = a['referencePlace'] == b['referencePlace']
        predicted = a['predictedPlace'] is not None and a['predictedPlace'] == b['predictedPlace']
        outcome = ('TP' if predicted else 'FN') if actual else ('FP' if predicted else 'TN')
        pairs.append({'a': a['segmentId'], 'b': b['segmentId'], 'referenceA': a['referencePlace'], 'referenceB': b['referencePlace'], 'predictedA': a['predictedPlace'], 'predictedB': b['predictedPlace'], 'outcome': outcome})
        for x, y in itertools.product(a['ids'], b['ids']):
            same = predictions.get(x) is not None and predictions.get(x) == predictions.get(y)
            observation_counts[('TP' if same else 'FN') if actual else ('FP' if same else 'TN')] += 1
    def metrics(counts):
        tp, fp, fn, tn = (counts[k] for k in ['TP', 'FP', 'FN', 'TN'])
        return {'TP': tp, 'FP': fp, 'FN': fn, 'TN': tn, 'precision': tp / (tp + fp) if tp + fp else None, 'recall': tp / (tp + fn) if tp + fn else None}
    return {'schema': 'cross-visit-revisit-diagnostic-v1', 'policy': {'unit': 'nonadjacent reference visit pairs; one or more intervening visits', 'prediction': 'same persistent ID with strict majority of all non-boundary members in each visit', 'boundary': 'exclude reference boundaryUncertain observations only', 'missing': 'no majority/null predicts no revisit; positive remains FN', 'secondary': 'all cross-visit non-boundary observation pairs; correlated samples, not independent trials', 'authority': bundle['scope'].get('referenceAuthority'), 'limitations': 'Frozen reference-label identity agreement, not newly image-adjudicated accuracy; coarse place labels may disagree with legitimate region granularity. No true-negative sampling or favorable subset selection.'}, 'visitPairMetrics': metrics(collections.Counter(p['outcome'] for p in pairs)), 'observationPairMetrics': metrics(observation_counts), 'visits': ordered, 'pairs': pairs}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('bundle', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    raw = args.bundle.read_bytes()
    report = score(json.loads(raw))
    report['bundleSHA256'] = hashlib.sha256(raw).hexdigest()
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print(json.dumps({k: report[k] for k in ['visitPairMetrics', 'observationPairMetrics']}, ensure_ascii=False))
    for pair in report['pairs']:
        if pair['outcome'] in ['TP', 'FN']:
            print(json.dumps(pair, ensure_ascii=False))

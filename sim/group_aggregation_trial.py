"""Offline hypothesis trial: visual group affinity is NOT verified region identity."""
import argparse
import hashlib
import json
from pathlib import Path
from fixed_region_queries import score_queries


def aggregate(assignments, evidence, minimum=0.4, coverage=0.5):
    groups = {}
    for id, group in assignments.items():
        if group is not None:
            groups.setdefault(group, []).append(id)
    affinity = {}
    candidates = []
    names = list(groups)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            neighbors = {x: [y for y in groups[b] if evidence.get(tuple(sorted((x, y))), 0) >= minimum] for x in groups[a]}
            matched = {}
            def augment(x, seen):
                for y in neighbors[x]:
                    if y not in seen:
                        seen.add(y)
                        if y not in matched or augment(matched[y], seen):
                            matched[y] = x
                            return True
                return False
            for x in neighbors:
                augment(x, set())
            fraction = min(len(matched) / len(groups[a]), len(matched) / len(groups[b]))
            eligible = len(matched) >= 2 and fraction >= coverage
            affinity[frozenset((a, b))] = eligible
            if eligible:
                support = [{'a': x, 'b': y, 'confidence': evidence[tuple(sorted((x, y)))]} for y, x in matched.items()]
                candidates.append({'a': a, 'b': b, 'anchorMatches': len(matched), 'coverage': fraction, 'support': support})
    # All constituent group pairs need positive support; do not single-link chain.
    clusters = [[name] for name in names]
    applied = []
    for candidate in sorted(candidates, key=lambda row: (-row['coverage'], -row['anchorMatches'], row['a'], row['b'])):
        left = next(c for c in clusters if candidate['a'] in c)
        right = next(c for c in clusters if candidate['b'] in c)
        if left is right:
            continue
        if not all(affinity.get(frozenset((a, b)), False) for a in left for b in right):
            continue
        applied.append(candidate)
        left.extend(right); clusters.remove(right)
    mapping = {group: cluster[0] for cluster in clusters for group in cluster}
    return {id: mapping[group] if group is not None else None for id, group in assignments.items()}, candidates, applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('replay', type=Path); parser.add_argument('evidence', type=Path)
    parser.add_argument('queries', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args()
    read = lambda path: json.loads(path.read_text(encoding='utf-8'))
    replay, pairs = read(args.replay), read(args.evidence)
    second = lambda scores: sorted(scores, reverse=True)[1] if len(scores) >= 2 else 0
    evidence = {tuple(sorted((p['a'], p['b']))): min(second(p['bearings']), second(p.get('backwardBearings', []))) for p in pairs}
    snapshot = replay['online']['snapshots'][-1]
    assignments, candidates, applied = aggregate(snapshot['assignments'], evidence)
    revised = [*replay['online']['snapshots'][:-1], {**snapshot, 'assignments': assignments}]
    # Labels accessed only AFTER prediction to review sandbox consequences.
    contract = read(args.queries)
    labels = contract['labels']
    for candidate in candidates:
        regions = {labels[id] for id, group in snapshot['assignments'].items() if group in [candidate['a'], candidate['b']] and labels[id] is not None}
        candidate['review'] = 'different-reviewed-regions' if len(regions) > 1 else 'same-reviewed-region' if regions else 'unreviewed'
    result = {'protocol': 'visual-group-aggregation-hypothesis-trial-v1',
              'policy': {'confidence': 0.4, 'minimumIndependentObservationMatches': 2, 'groupCoverage': 0.5, 'clusterConstraint': 'all constituent pairs have positive support'},
              'inputs': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.replay, args.evidence, args.queries]},
              'candidates': candidates, 'appliedSandboxUnions': applied,
              'before': score_queries(contract, replay['online']['snapshots']), 'after': score_queries(contract, revised),
              'note': 'Final-only retrospective visual affinity hypothesis, not production region acceptance or calibrated probability. Cached same-bearing reciprocal multi-view matches; NOT new cross-camera matching, independent surfaces or measured boundary evidence. Labels used only for scoring; original replay unchanged.'}
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps({'before': result['before']['overall'], 'after': result['after']['overall'], 'candidateReviews': [c['review'] for c in candidates], 'unions': len(applied)}, indent=2))


if __name__ == '__main__':
    main()

"""Full retrospective agglomeration; every original group participates.

No label-based stopping, fixed number of regions or safety acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path
from fixed_region_queries import score_queries


def affinity(left, right, evidence):
    # Mutual mean nearest support. Missing evidence contributes zero, not a
    # different-region claim. This is an uncalibrated visual heuristic.
    a = [max((evidence.get(tuple(sorted((x, y))), 0) for y in right), default=0) for x in left]
    b = [max((evidence.get(tuple(sorted((x, y))), 0) for x in left), default=0) for y in right]
    return min(sum(a) / len(a), sum(b) / len(b))


def hierarchy(assignments, evidence):
    groups = {}
    for id, group in assignments.items():
        if group is None:
            raise ValueError('Full trial requires assigned original inventory')
        groups.setdefault(group, []).append(id)
    clusters = [{'id': group, 'sourceGroups': [group], 'observations': ids} for group, ids in groups.items()]
    levels = [{'groups': json.loads(json.dumps(clusters)), 'merge': None}]
    while len(clusters) > 1:
        choices = [(affinity(a['observations'], b['observations'], evidence), i, j) for i, a in enumerate(clusters) for j, b in enumerate(clusters) if j > i]
        strength, i, j = max(choices, key=lambda row: (row[0], -row[1], -row[2]))
        left, right = clusters[i], clusters[j]
        merged = {'id': left['id'], 'sourceGroups': left['sourceGroups'] + right['sourceGroups'], 'observations': left['observations'] + right['observations']}
        clusters[i] = merged; clusters.pop(j)
        levels.append({'groups': json.loads(json.dumps(clusters)), 'merge': {'leftSourceGroups': left['sourceGroups'], 'rightSourceGroups': right['sourceGroups'], 'affinity': strength, 'forcedUnsupported': strength == 0}})
    return levels


def grouping_metrics(assignments, labels):
    reviewed = [id for id, label in labels.items() if label is not None]
    same = different = aggregated = wrong = 0
    for i, a in enumerate(reviewed):
        for b in reviewed[i + 1:]:
            equal = labels[a] == labels[b]; together = assignments[a] == assignments[b]
            same += equal; different += not equal; aggregated += equal and together; wrong += not equal and together
    groups = {}
    for id in reviewed:
        groups.setdefault(assignments[id], []).append(id)
    return {'sameRegionAggregation': aggregated / same if same else None, 'wrongMergeRate': wrong / different if different else None,
            'samePairs': same, 'aggregatedSamePairs': aggregated, 'differentPairs': different, 'wrongMergedPairs': wrong,
            'mixedGroups': {g: members for g, members in groups.items() if len({labels[id] for id in members}) > 1}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('replay', type=Path); parser.add_argument('evidence', type=Path); parser.add_argument('queries', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args()
    read = lambda p: json.loads(p.read_text(encoding='utf-8'))
    replay, pairs = read(args.replay), read(args.evidence)
    second = lambda values: sorted(values, reverse=True)[1] if len(values) > 1 else 0
    evidence = {tuple(sorted((p['a'], p['b']))): min(second(p['bearings']), second(p.get('backwardBearings', []))) for p in pairs}
    snapshots = replay['online']['snapshots']
    levels = hierarchy(snapshots[-1]['assignments'], evidence)
    # Algorithm-only selection: stop at FIRST next merge below fixed .4.
    selected = 0
    for index, level in enumerate(levels[1:], 1):
        if level['merge']['affinity'] < .4:
            break
        selected = index
    contract = read(args.queries)  # Answer isolation: prediction already finished.
    for index, level in enumerate(levels):
        assignments = {id: group['id'] for group in level['groups'] for id in group['observations']}
        revised = [*snapshots[:-1], {**snapshots[-1], 'assignments': assignments}]
        level['groupCount'] = len(level['groups'])
        level['selectedWithoutLabels'] = index == selected
        level['queryScore'] = score_queries(contract, revised)
        level['groupingMetrics'] = grouping_metrics(assignments, contract['labels'])
        for group in level['groups']:
            group['reviewedLabelCounts'] = {label: sum(contract['labels'][id] == label for id in group['observations']) for label in sorted(set(contract['labels'].values()) - {None})}
    result = {'protocol': 'full-group-agglomeration-trial-v1', 'policy': 'All groups, recomputed mutual mean nearest visual affinity; first below .4 stops automatic selection; complete dendrogram to 1 retained ONLY for diagnostic forced levels.',
              'inputs': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.replay, args.evidence, args.queries]}, 'selectedLevel': selected, 'levels': levels,
              'note': 'Final-only sandbox. Known labels/region count not used in clustering or selection. Forced low/zero support levels are not validated region decisions. Cached same-bearing evidence, no new cross-camera extraction; AI development labels, not spatially random hardware accuracy.'}
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    for level in levels:
        metrics = level['groupingMetrics']; score = level['queryScore']['overall']
        print(json.dumps({'groups': level['groupCount'], 'mergeAffinity': level['merge']['affinity'] if level['merge'] else None, 'selected': level['selectedWithoutLabels'], 'correct': score['correct'], 'queries': score['total'], 'aggregation': metrics['sameRegionAggregation'], 'wrongMerge': metrics['wrongMergeRate'], 'mixedGroups': len(metrics['mixedGroups'])}))


if __name__ == '__main__':
    main()

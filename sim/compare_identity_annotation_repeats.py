"""Compare grouping up to arbitrary region numbering and annotation volume."""
import argparse
import json
from itertools import combinations
from pathlib import Path


def compare(first, second):
    a, b = first['finalAssignments'], second['finalAssignments']
    if set(a) != set(b):
        raise ValueError('Different inventories')
    changed_pairs = [list(pair) for pair in combinations(sorted(a), 2)
                     if bool(a[pair[0]] and a[pair[0]] == a[pair[1]]) != bool(b[pair[0]] and b[pair[0]] == b[pair[1]])]
    def annotations(report):
        result = {}
        for row in report['answer']['imageAnnotations']:
            index = row['claimedRegionIndex']
            identity = tuple(sorted(report['answer']['regions'][index-1]['groupIds'])) if index is not None else None
            result[row['observationRef']] = (row['kind'], identity)
        return result
    x, y = annotations(first), annotations(second)
    return {'groupingChangedPairs': changed_pairs, 'unknownStatusChangedIds': [id for id in a if (a[id] is None) != (b[id] is None)],
            'annotationCounts': [len(x), len(y)], 'annotationDensity': [first['annotationReview']['density'], second['annotationReview']['density']],
            'annotationChangedRefs': sorted(ref for ref in x.keys() | y.keys() if x.get(ref) != y.get(ref)),
            'scores': [first['score']['overall'], second['score']['overall']],
            'note': 'Region numbers normalized by group membership; wording differences ignored. Only two repeats on similar-route development data; no reliability claim.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['first', 'second', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    result = compare(*[json.loads(p.read_text(encoding='utf-8')) for p in [args.first, args.second]])
    with args.output.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=True, indent=2))

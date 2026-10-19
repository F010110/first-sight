"""Explicit user-approved coarser granularity; never rewrite fine labels."""
import argparse
import hashlib
import json
from pathlib import Path
from sim.grouping.fixed_region_queries import score_queries
from sim.grouping.full_group_aggregation_trial import grouping_metrics


def coarsen(contract):
    result = json.loads(json.dumps(contract))
    mapping = {'kitchen-dining': 'open-living-area', 'living-sofa': 'open-living-area'}
    result['protocol'] = 'fixed-region-queries-open-living-v1'
    result['granularityChange'] = {'mapping': mapping, 'authorization': 'User accepts kitchen/living as one open living space; post-hoc alternative granularity, not independent validation.'}
    result['labels'] = {id: mapping.get(label, label) for id, label in contract['labels'].items()}
    for query in result['queries']:
        query['label'] = result['labels'][query['id']]
        query['scenario'] = 'old' if any(result['labels'][id] == query['label'] for id in query['historicalIds']) else 'new'
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('replay', type=Path)
    parser.add_argument('queries', type=Path); parser.add_argument('contract', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('reports', nargs='+', type=Path)
    args = parser.parse_args()
    read = lambda p: json.loads(p.read_text(encoding='utf-8'))
    fine = read(args.queries); coarse = coarsen(fine)
    snapshots = read(args.replay)['online']['snapshots']
    if args.contract.exists():
        if read(args.contract) != coarse:
            raise ValueError('Frozen coarser contract differs')
    else:
        with args.contract.open('x', encoding='utf-8') as output:
            json.dump(coarse, output, ensure_ascii=False, indent=2)
    result = {'protocol': 'open-living-region-rescore-v1', 'sourceContractSha256': hashlib.sha256(args.queries.read_bytes()).hexdigest(), 'coarseContractSha256': hashlib.sha256(args.contract.read_bytes()).hexdigest(), 'runs': {}, 'note': 'Same 44 reviewed queries, changed explicitly approved granularity only. Prior plus result rescored post hoc. Flash run separate; labels not provided to either VLM. Excluded/boundary images remain unreviewed.'}
    for path in args.reports:
        report = read(path)
        revised = [*snapshots[:-1], {**snapshots[-1], 'assignments': report['finalAssignments']}]
        result['runs'][str(path)] = {'model': report['modelReturned'], 'originalFineOverall': report['after']['overall'], 'coarseFinal': score_queries(coarse, revised), 'grouping': grouping_metrics({id: group if group is not None else f'unknown-{id}' for id, group in report['finalAssignments'].items()}, coarse['labels']), 'inputReportSha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps({run['model']: {'fine': run['originalFineOverall'], 'coarse': run['coarseFinal']['overall'], 'old': run['coarseFinal']['old'], 'new': run['coarseFinal']['new'], 'grouping': run['grouping']} for run in result['runs'].values()}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()

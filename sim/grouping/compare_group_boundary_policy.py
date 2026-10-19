"""Saved-output ablation, not a fresh VLM majority-vote experiment."""
import argparse
import hashlib
import json
from pathlib import Path
from sim.grouping.fixed_region_queries import score_queries
from sim.grouping.vlm_boundary_group_trial import assignments_from_answer, review_boundary_detection
from sim.grouping.full_group_aggregation_trial import grouping_metrics


def main():
    parser = argparse.ArgumentParser()
    for name in ['manifest', 'report', 'review', 'queries', 'replay', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    read = lambda p: json.loads(p.read_text(encoding='utf-8'))
    manifest, report, review, queries, replay = [read(getattr(args, name)) for name in ['manifest', 'report', 'review', 'queries', 'replay']]
    answer = json.loads(json.dumps(report['answer']))
    answer['boundaryObservations'] = []
    assignments, boundaries = assignments_from_answer(answer, manifest['groups'])
    snapshots = replay['online']['snapshots']
    def score(mapping):
        return score_queries(queries, [*snapshots[:-1], {**snapshots[-1], 'assignments': mapping}])
    labels = {row['observationId']: row for row in review['labels']}
    mixed = []
    for name, group in manifest['groups'].items():
        core = [id for id in group['observationIds'] if labels[id]['kind'] == 'core']
        transition = [id for id in group['observationIds'] if labels[id]['kind'] == 'boundary']
        if core and transition:
            mixed.append({'group': name, 'coreIds': core, 'boundaryIds': transition, 'coreRegions': sorted({queries['labels'][id] for id in core}), 'shownIds': group['selectedObservationIds']})
    result = {'protocol': 'saved-output-no-partial-boundary-ablation-v1',
              'note': 'Disable partial boundary overrides only. Keep existing core assignments, whole boundaries and quarantines. Not fresh VLM inference, NOT majority voting. Review labels used only for scoring/diagnosis.',
              'before': score(report['finalAssignments']), 'after': score(assignments),
              'changedIds': [id for id in assignments if assignments[id] != report['finalAssignments'][id]],
              'beforeBoundary': review_boundary_detection(report['boundaryGroups'], review['labels']),
              'afterBoundary': review_boundary_detection(boundaries, review['labels']),
              'afterGrouping': grouping_metrics({id: group or f'unknown-{id}' for id, group in assignments.items()}, queries['labels']),
              'mixedCoreBoundarySourceGroups': mixed,
              'inputs': {str(getattr(args, name)): hashlib.sha256(getattr(args, name).read_bytes()).hexdigest() for name in ['manifest', 'report', 'review', 'queries', 'replay']}}
    with args.output.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    print(json.dumps({key: result[key] for key in ['changedIds', 'afterBoundary', 'afterGrouping', 'mixedCoreBoundarySourceGroups']}, ensure_ascii=True, indent=2))
    print('before', result['before']['overall'], 'after', result['after']['overall'])


if __name__ == '__main__':
    main()

"""Read-only trace diagnosis. Flags are review leads, not semantic verdicts."""
import argparse
import json
from pathlib import Path


def diagnose(root):
    records = []
    for path in sorted(root.glob('*-matcher-binding.json')):
        trial_path = root / path.name.replace('-matcher-binding', '')
        binding = json.loads(path.read_text(encoding='utf-8'))
        trial = json.loads(trial_path.read_text(encoding='utf-8'))
        checks = []
        for turn in reversed(trial['trace']):
            call = turn.get('call', {})
            if isinstance(call, dict) and call.get('tool') == 'memory_add':
                checks = call.get('evidenceChecks', call.get('arguments', {}).get('evidenceChecks', []))
                break
        reviews = []
        for i, pair in enumerate(binding['selected']):
            check = next((c for c in checks if c.get('pairId') == f'pair-{i}'), {})
            current_id = pair['current']['id']
            assigned = next((s['assessment']['location'] for s in trial['segments']
                             if current_id in s['observationIds']), {})
            reviews.append({
                'pairId': f'pair-{i}', 'channel': pair['channel'],
                'current': pair['current'], 'historical': pair['historical'],
                'candidatePlaceId': pair['placeId'], 'check': check,
                'assignedLocationAtMatchedObservation': assigned,
                'acceptedPairButDifferentAssignment': check.get('verdict') == 'same'
                and assigned.get('placeId') != pair['placeId'],
            })
        records.append({'trial': trial_path.name, 'arm': trial['arm'],
                        'slot': trial['slot'], 'repetition': trial['repetition'],
                        'initialImages': len(binding['images']), 'finalImages': trial['images'],
                        'fullTargetRecovery': trial['fullTargetRecovery'],
                        'errors': [t['error'] for t in trial['trace'] if t.get('error')],
                        'pairReviews': reviews})
    return {'limitations': ['Flags require source-image review, not automatic correction.',
                            'Pair acceptance does not mechanically determine a segment or place ID.',
                            'No truth labels inferred from historical production IDs.'], 'records': records}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('probe_directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(diagnose(args.probe_directory), ensure_ascii=False, indent=2))

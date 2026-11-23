"""Free structural audit of saved prompt-origin trials, never rewrites results."""
import argparse
from collections import Counter
import json
from pathlib import Path


def audit(root):
    report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
    rows = []
    for result in report['results']:
        call = result.get('call')
        if not isinstance(call, dict):
            call = next((t['call'] for t in reversed(result['trace'])
                         if isinstance(t.get('call'), dict)), {})
        segments = call.get('arguments', {}).get('segments', [])
        checks = call.get('associationChecks', call.get('arguments', {}).get('associationChecks', []))
        visible = {i['id'] for i in result['images']}
        actual = [i for s in segments for i in s.get('observationIds', [])]
        errors = []
        duplicates = [i for i, count in Counter(actual).items() if count > 1]
        if duplicates:
            errors.append({'kind': 'duplicate-coverage', 'ids': duplicates})
        for index, segment in enumerate(segments):
            location = segment.get('assessment', {}).get('location')
            if not isinstance(location, dict):
                errors.append({'kind': 'missing-assessment-location', 'segmentIndex': index})
                continue
            missing = [i for i in location.get('sourceIds', []) if i not in visible]
            if missing:
                errors.append({'kind': 'uninspected-source-citation', 'ids': missing})
        rows.append({'arm': result['arm'], 'repetition': result['repetition'],
                     'stage': result['stage'], 'rawValid': result['valid'],
                     'rawError': result['error'], 'elapsedMs': result['elapsedMs'],
                     'structuralErrors': errors,
                     'checks': [{'pairId': c.get('pairId'), 'verdict': c.get('verdict')}
                                for c in checks]})
    return {'scope': 'Structural evidence only; semantic judgments require original-image/map review.',
            'records': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.directory), ensure_ascii=False, indent=2))

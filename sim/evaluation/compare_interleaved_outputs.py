"""Read-only comparison of frozen old answers and new provider receipts."""
import collections
import json
from pathlib import Path

OLD = Path('run/school-spatial-oracle-v1/spatial-memory-locked-protocol-v1')
NEW = Path('run/interleaved-memory-90-budget16-v4')


def rows(path):
    return [json.loads(s) for s in path.read_text(encoding='utf8').splitlines() if s.strip()]


def compare():
    old = {r['id']: r for r in rows(OLD / 'results.jsonl')}
    questions = {(q['question'], q['currentObservationId']): q for q in json.loads((NEW / 'calendar-questions.json').read_text(encoding='utf8'))}
    calls = collections.defaultdict(list)
    for directory in sorted((NEW / 'requests').iterdir()):
        if not directory.is_dir() or not (directory / 'response.txt').exists():
            continue
        inp = json.loads((directory / 'input.json').read_text(encoding='utf8'))
        question = questions.get((inp.get('question'), inp.get('observations', [{}])[-1].get('id')))
        if not question:
            continue
        body = json.loads((directory / 'response.txt').read_text(encoding='utf8'))
        try:
            decision = json.loads(body['choices'][0]['message']['content'])
        except (KeyError, ValueError):
            continue
        calls[question['id']].append({'request': directory.name, 'action': decision.get('next'),
                                      'candidates': inp.get('candidates', []),
                                      'requiredIds': inp.get('requiredEvidenceIds', []),
                                      'inspectedIds': inp.get('inspectedIds', []),
                                      'feedback': inp.get('feedback')})
    comparisons = []
    for result in rows(NEW / 'full/results.jsonl'):
        key = result['id']
        chain = calls[key]
        actions = [(c['action'] or {}).get('kind') for c in chain]
        required = set(chain[0]['requiredIds']) if chain else set()
        current = set(chain[0]['inspectedIds']) if chain else set()
        historical = required - current
        found = any(historical and historical.issubset({c['id'] for c in call['candidates']}) for call in chain)
        queries = [(c['action'] or {}).get('query') for c in chain if (c['action'] or {}).get('kind') == 'search']
        comparisons.append({'id': key, 'failed': bool(result.get('error')),
                            'allActionsSearch': bool(actions) and all(a == 'search' for a in actions),
                            'historicalRequiredCandidatesFound': found,
                            'distinctSearchQueries': len(set(queries)),
                            'inspectActions': actions.count('inspect'),
                            'oldAnswer': old[key].get('result', {}).get('answer', old[key].get('result', {}).get('raw')),
                            'oldInspectedIds': old[key].get('inspectedIds'),
                            'oldModelCalls': old[key].get('result', {}).get('historicalTrace', {}).get('modelCalls'),
                            'newResult': result, 'chain': chain})
    failed = [r for r in comparisons if r['failed']]
    return {'readOnly': True, 'old': str(OLD), 'new': str(NEW),
            'summary': {'questions': len(comparisons), 'failed': len(failed),
                        'failedAllActionsSearch': sum(r['allActionsSearch'] for r in failed),
                        'failedRequiredCandidatesFound': sum(r['historicalRequiredCandidatesFound'] for r in failed),
                        'failedNoInspect': sum(r['inspectActions'] == 0 for r in failed)},
            'comparisons': comparisons}


if __name__ == '__main__':
    report = compare()
    output = Path('run/interleaved-vs-locked-output-comparison-v2.json')
    if output.exists():
        raise ValueError('Never overwrite comparison output')
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report['summary']))

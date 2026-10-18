"""Offline selective protocol rescore; reuse semantic judgments, never call VLM."""
import json
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding='utf8'))


def lines(path):
    return [json.loads(s) for s in path.read_text(encoding='utf8').splitlines()]


def report(base, bank):
    tasks = {t['id']: t for t in load(bank / 'evaluation-only/tasks.json')}
    groups = {}
    for mode, version in [('spatial-memory', 'v1'), ('memory-oracle', 'v2')]:
        old = base / (mode + '-runtime-fixed-v4')
        new = base / (mode + '-locked-protocol-' + version)
        originals = {p['id']: p for p in lines(old / 'full/results.jsonl')}
        grades = {g['id']: g for g in lines(old / 'full-grading/grades.jsonl')}
        records = lines(new / 'results.jsonl')
        assert len(records) == len({r['id'] for r in records}) == 90
        rows = {r['id']: r for r in lines(old / 'model-replay/observations.jsonl')}
        changes = []
        for record in records:
            key = record['id']
            if record == originals[key]:
                continue
            assert record.get('protocolRepair', {}).get('answerPreserved')
            before = json.loads(originals[key]['result']['raw'])
            after = json.loads(record['result']['raw'])
            metadata = {'historicalEvidenceIds', 'abstained'}
            assert {k: v for k, v in before.items() if k not in metadata} == {
                k: v for k, v in after.items() if k not in metadata}
            task = tasks[key]
            citations = after['historicalEvidenceIds']
            invalid = any(i not in record['inspectedIds'] or i not in rows or
                          rows[i]['atMs'] >= task['queryAtMs'] for i in citations)
            reference = any(all(i in citations for i in group)
                            for group in task['validEvidenceSets'])
            receipt = load(old / 'full-grading' / f'{key}-{mode}-judge.json')
            judge = json.loads(receipt['response']['choices'][0]['message']['content'])
            harm = max(judge['harm'], 1 if invalid else 0,
                       1 if not task['answerable'] and not after['abstained'] else 0)
            utility = (judge['credit'] if not after['abstained'] and reference and
                       not invalid and harm < 1 else 0) if task['answerable'] else (
                           judge['credit'] if after['abstained'] and harm == 0 else 0)
            previous = grades[key]
            changes.append({'id': key, 'beforeUtility': previous['utility'],
                            'afterUtility': utility, 'beforeHarm': previous['harm'],
                            'afterHarm': harm, 'semanticJudgmentReused': True})
            grades[key] = {**previous, 'utility': utility, 'harm': harm,
                           'modelOutputRejected': False,
                           'referenceEvidenceSatisfied': reference,
                           'invalidCitations': invalid}
        all_grades = list(grades.values())
        difficult = [g for g in all_grades if g['tier'] == 'long' or
                     tasks[g['id']].get('family') == 'compare']
        mean = lambda xs: sum(xs) / len(xs)
        groups[mode] = {
            'cards': {'实际问题解决': mean([g['utility'] * 100 for g in all_grades]),
                      '长程与干扰': mean([g['utility'] * 100 for g in difficult]),
                      '回答可信': mean([(1-g['harm']) * 100 for g in all_grades])},
            'byTier': {tier: mean([g['utility'] * 100 for g in all_grades
                                  if g['tier'] == tier]) for tier in ['current', 'short', 'long']},
            'changes': changes, 'unchangedGrades': 90-len(changes)}
    return {'status': 'offline-selective-protocol-rescore-not-fresh-run',
            'policy': 'Original factual answers and semantic judge receipts retained; only protocol effects recomputed using original scoring rules.',
            'groups': groups}


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('base', type=Path)
    p.add_argument('bank', type=Path)
    p.add_argument('output', type=Path)
    args = p.parse_args()
    result = report(args.base, args.bank)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(result, ensure_ascii=True, indent=2))

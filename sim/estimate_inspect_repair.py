"""User-requested offline projection, never a fresh 90-question score."""
import hashlib
import json
from pathlib import Path


def lines(path):
    return [json.loads(s) for s in path.read_text(encoding='utf8').splitlines() if s.strip()]


def estimate():
    baseline = Path('run/interleaved-memory-90-budget16-v4')
    probe = Path('run/inspect-repair-44-probe-v1')
    original = lines(baseline / 'full-grading/grades.jsonl')
    repairs = lines(probe / 'semantic-grading/grades.jsonl')
    failures = {r['id'] for r in lines(baseline / 'full/results.jsonl') if r.get('error')}
    assert len(original) == 90 and len({g['id'] for g in original}) == 90
    assert len(repairs) == 44 and {g['id'] for g in repairs} == failures
    tasks = {q['id']: q for q in json.loads(Path('D:/Datasets/activity-benchmark-v1/school-memory-tasks-v2/evaluation-only/tasks.json').read_text(encoding='utf8'))}
    replacement = {g['id']: g for g in repairs}
    projected = [replacement.get(g['id'], g) for g in original]
    mean = lambda xs: sum(xs) / len(xs) * 100
    difficult = [g for g in projected if g['tier'] == 'long' or tasks[g['id']].get('family') == 'compare']
    inputs = [baseline / 'full-grading/grades.jsonl', baseline / 'full/results.jsonl', probe / 'semantic-grading/grades.jsonl']
    return {'status': 'offline-hybrid-projection-NOT-new-90-question-evaluation',
            'assumption': 'Keep 46 baseline grades unchanged; substitute all 44 diagnostic grades, including both errors. No best-answer selection. Captured-state results may not transfer to a fresh evolving Context.',
            'questions': 90, 'unchangedBaseline': 46, 'targetedSubstitutions': 44,
            'cards': {'实际问题解决': mean([g['utility'] for g in projected]),
                      '长程与干扰': mean([g['utility'] for g in difficult]),
                      '回答可信': mean([1-g['harm'] for g in projected])},
            'byTier': {tier: mean([g['utility'] for g in projected if g['tier'] == tier]) for tier in ['current', 'short', 'long']},
            'sources': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
            'limitations': ['Not a confidence interval or unbiased forecast', 'Fresh-context same-family automated judge, not independent human truth', 'Changes to earlier answers can change later Context, identities and answers', 'Does not certify physical place graph accuracy']}


if __name__ == '__main__':
    out = Path('run/inspect-repair-offline-estimate-v1.json')
    if out.exists():
        raise ValueError('Never overwrite estimates')
    result = estimate()
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(result, ensure_ascii=True, indent=2))

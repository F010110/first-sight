"""Three unchanged approved cases; diagnostic only, never replaces the full pilot gate."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path('run/unioncity-organized-pilot-v2-freeze')
out = Path('run/unioncity-investigator-smoke-v1-freeze')
plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
prior = []
for version in ['v1', 'v2', 'v3']:
    for lane in ['run1', 'score1']:
        root = Path(f'run/unioncity-organized-pilot-{version}-{lane}')
        raw = (root / 'requests/usage.json').read_bytes()
        usage = json.loads(raw)
        if usage['unknownCallsReserved']:
            raise RuntimeError('Unresolved billing reservation')
        prior.append({'path': str(root.resolve()), 'usageSHA256': hashlib.sha256(raw).hexdigest(),
                      'estimatedUSD': usage['estimatedUSD'], 'calls': usage['calls']})
spent = sum(p['estimatedUSD'] for p in prior)
if spent + .075 > .40:
    raise RuntimeError('Original cumulative USD0.40 cap exceeded')
shutil.copytree(source, out)
ids = ['L07', 'L10', 'L25']
tasks = json.loads((out / 'tasks.json').read_text(encoding='utf-8'))
tasks = [next(t for t in tasks if t['id'] == id) for id in ids]
raw = json.dumps(tasks, ensure_ascii=False, indent=2).encode('utf-8')
(out / 'tasks.json').write_bytes(raw)
plan.update(schema='unioncity-memory-investigator-smoke-v1', questions=3, expectedBranches=3,
            normal=ids, memoryDisabled=[], suppliedEvidenceDiagnosticOnly=[], focusedDiagnosticOnly=True,
            verifyTarget=False, previousAttempts=prior, priorIterationSpend=spent,
            tasksSHA256=hashlib.sha256(raw).hexdigest(), maxUSD={'answers': .05, 'grading': .025, 'pilotTotal': .40},
            maxCalls={'answers': 104, 'grading': 3})
plan['budgetScope'] = 'Original cumulative USD0.40 cap; three approved-case smoke only; no large run or fresh budget'
plan['full90Conditional'] = 'This focused smoke cannot authorize scale-up. Original 15-case gates still required and unchanged.'
plan['changes'] = ['Memory investigator rather than direct locate', 'Literal hints, chronological reading, neighbors, original inspection, coverage and recall',
                   'Up to three resumable investigations; time relaxed, finite original shared USD cap retained']
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'freeze': str(out), 'priorUSD': spent, 'worstCaseUSD': spent + .075}))

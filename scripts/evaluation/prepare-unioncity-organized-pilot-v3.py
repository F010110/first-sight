"""Final budget-bounded target-planning/verification pilot, unchanged questions and gates."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path('run/unioncity-organized-pilot-v2-freeze')
out = Path('run/unioncity-organized-pilot-v3-freeze')
plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
prior = []
for version in ['v1', 'v2']:
    for lane in ['run1', 'score1']:
        root = Path(f'run/unioncity-organized-pilot-{version}-{lane}')
        raw = (root / 'requests/usage.json').read_bytes()
        usage = json.loads(raw)
        if usage['unknownCallsReserved']:
            raise RuntimeError('Unresolved billing')
        prior.append({'path': str(root.resolve()), 'usageSHA256': hashlib.sha256(raw).hexdigest(),
                      'estimatedUSD': usage['estimatedUSD'], 'calls': usage['calls']})
spent = sum(p['estimatedUSD'] for p in prior)
if spent + .16 > .40:
    raise RuntimeError('Original cumulative cap exceeded')
shutil.copytree(source, out)
plan.update(schema='unioncity-verified-organized-pilot-v1', verifyTarget=True, previousAttempts=prior,
            priorIterationSpend=spent, maxUSD={'answers': .09, 'grading': .07, 'pilotTotal': .40})
plan['changes'] = ['Separate bounded target plan', 'Actually execute locate and sequence for historical plan',
                   'Independent source-only pre-delivery target check; no private reference or scoring feedback',
                   'Rejected drafts retained; finite original answer loop and shared call/USD cap']
plan['budgetScope'] = 'Original USD0.40 cumulative cap; this attempt caps answers .09 and grades .07; no further paid retry'
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'priorUSD': spent, 'worstCaseUSD': spent + .16, 'freeze': str(out)}))

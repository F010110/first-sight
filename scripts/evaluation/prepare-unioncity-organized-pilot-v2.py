"""Second bounded attempt within the SAME USD0.40 iteration cap. Questions/gates unchanged."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path('run/unioncity-organized-pilot-v1-freeze')
out = Path('run/unioncity-organized-pilot-v2-freeze')
plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
prior = []
for root in ['run/unioncity-organized-pilot-v1-run1', 'run/unioncity-organized-pilot-v1-score1']:
    path = Path(root) / 'requests/usage.json'
    raw = path.read_bytes()
    usage = json.loads(raw)
    if usage['unknownCallsReserved']:
        raise RuntimeError('Unresolved billing reservations')
    prior.append({'path': str(Path(root).resolve()), 'usageSHA256': hashlib.sha256(raw).hexdigest(),
                  'estimatedUSD': usage['estimatedUSD'], 'calls': usage['calls']})
spent = sum(r['estimatedUSD'] for r in prior)
if spent + .24 > .40:
    raise RuntimeError('Cumulative iteration cap exceeded')
shutil.copytree(source, out)
plan['schema'] = 'unioncity-organized-pilot-v2'
plan['previousAttempts'] = prior
plan['maxUSD'] = {'answers': .12, 'grading': .12, 'pilotTotal': .40}
plan['budgetScope'] = 'Same USD0.40 cap: prior spend plus both new caps; no further expansion or retries'
plan['priorIterationSpend'] = spent
plan['changes'] = ['Explicit fact/episode reference distinction', 'Generic shop noun recall',
                   'Source-backed chronological sequence expansion, not certified entry/identity',
                   'Reject question echo; preserve all prior failures and original gates']
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'freeze': str(out), 'priorUSD': spent, 'worstCaseIterationUSD': spent + .24}))

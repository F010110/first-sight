"""Freeze the already-approved 15 questions unchanged; no model calls."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path('run/unioncity-repair-pilot-v2-freeze')
out = Path('run/unioncity-organized-pilot-v1-freeze')
if out.exists():
    raise RuntimeError('Output already exists')
shutil.copytree(source, out)
plan = json.loads((out / 'plan.json').read_text(encoding='utf-8'))
index = Path('run/unioncity-organized-index-v3/organized.sqlite').resolve()
plan['schema'] = 'unioncity-organized-pilot-v1'
plan['organization'] = {'path': str(index), 'sha256': hashlib.sha256(index.read_bytes()).hexdigest(),
                        'scope': 'Frozen counterfactual organization; continuous writing tested separately, not a live producer measurement'}
plan['maxUSD'] = {'answers': .20, 'grading': .20, 'pilotTotal': .40}
plan['maxCalls'] = {'answers': 183, 'grading': 37}
plan['budgetScope'] = 'New iteration total USD0.40; answer and grading caps sum to total; no retries or expansion under a fresh cap'
plan['comparison'] = {'baseline': 'run/unioncity-repair-pilot-v2-run1', 'sameSnapshots': True,
                      'questionTextUnchanged': True, 'flatToolsDisabledInOrganizedNormal': True,
                      'splitGrading': True, 'ungradedUtility': None,
                      'expand90': False, 'gatesUnchanged': True}
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(out)

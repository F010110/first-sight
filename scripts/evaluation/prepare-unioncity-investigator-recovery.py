"""One unchanged approved question, retaining unknown reservations inside the original cap."""
import hashlib
import json
import shutil
from pathlib import Path

source = Path('run/unioncity-investigator-smoke-v1-freeze')
out = Path('run/unioncity-investigator-recovery-v1-freeze')
plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
prior = []
roots = [Path(f'run/unioncity-organized-pilot-{version}-{lane}')
         for version in ['v1', 'v2', 'v3'] for lane in ['run1', 'score1']]
roots.append(Path('run/unioncity-investigator-smoke-v1-run1'))
for root in roots:
    raw = (root / 'requests/usage.json').read_bytes()
    usage = json.loads(raw)
    # Unknown calls stay reserved at their entire original estimate, never treated as free.
    prior.append({'path': str(root.resolve()), 'usageSHA256': hashlib.sha256(raw).hexdigest(),
                  'estimatedUSD': usage['estimatedUSD'], 'calls': usage['calls'],
                  'unknownCallsReserved': usage['unknownCallsReserved']})
accounted = sum(p['estimatedUSD'] for p in prior)
if accounted + .04 > .40:
    raise RuntimeError('Original cumulative USD0.40 cap exceeded including ALL unknown reservations')
shutil.copytree(source, out)
tasks = json.loads((out / 'tasks.json').read_text(encoding='utf-8'))
tasks = [next(t for t in tasks if t['id'] == 'L07')]
raw = json.dumps(tasks, ensure_ascii=False, indent=2).encode('utf-8')
(out / 'tasks.json').write_bytes(raw)
plan.update(schema='unioncity-investigator-transport-recovery-v1', questions=1, expectedBranches=1,
            normal=['L07'], memoryDisabled=[], suppliedEvidenceDiagnosticOnly=[], focusedDiagnosticOnly=True,
            verifyTarget=False, previousAttempts=prior, priorIterationSpend=accounted,
            unknownReservationsPreserved=sum(p['unknownCallsReserved'] for p in prior),
            tasksSHA256=hashlib.sha256(raw).hexdigest(), maxUSD={'answers': .04, 'grading': 0, 'pilotTotal': .40},
            maxCalls={'answers': 104, 'grading': 0})
plan['budgetScope'] = 'One frozen transport-recovery probe, not a fresh cap. All prior unknown reservations remain held; zero paid judge calls.'
plan['full90Conditional'] = 'Never authorizes scale-up. Original full pilot gates remain mandatory.'
plan['changes'] = ['Provider adapter guarantees literal JSON for json_object output',
                   'No change to approved question, snapshot, reference or investigator policy']
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'freeze': str(out), 'accountedPriorUSD': accounted,
                  'unknownCallsStillReserved': plan['unknownReservationsPreserved'], 'worstCaseUSD': accounted + .04}))

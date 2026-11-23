"""Freeze unchanged approved cases for Pi runtime; never overwrite historical runs."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

attempt = sys.argv[1] if len(sys.argv) > 1 else 'v1'
if attempt not in {'v1', 'v2', 'v3', 'full-v1'}:
    raise RuntimeError('Expected v1 or full-v1')
source = Path('run/unioncity-investigator-generic-v1-freeze')
out = Path(f'run/unioncity-pi-harness-{attempt}-freeze')
shutil.copytree(source, out)
plan = json.loads((out / 'plan.json').read_text(encoding='utf-8'))
roots = [Path('run/unioncity-investigator-generic-v1-run1'), Path('run/unioncity-investigator-generic-v1-score1')]
if attempt in {'v2', 'v3', 'full-v1'}:
    roots += [Path('run/unioncity-pi-harness-v1-run1'), Path('run/unioncity-pi-harness-v1-score1')]
if attempt in {'v3', 'full-v1'}:
    roots += [Path('run/unioncity-pi-harness-v2-run1'), Path('run/unioncity-pi-harness-v2-score1')]
if attempt == 'full-v1':
    full = Path('run/unioncity-investigator-pilot-v1-freeze')
    original = json.loads((full / 'plan.json').read_text(encoding='utf-8'))
    for key in ['questions', 'normal', 'memoryDisabled', 'suppliedEvidenceDiagnosticOnly', 'expectedBranches', 'tasksSHA256']:
        plan[key] = original[key]
    shutil.copyfile(full / 'tasks.json', out / 'tasks.json')
for root in roots:
    raw = (root / 'requests/usage.json').read_bytes()
    usage = json.loads(raw)
    plan['previousAttempts'].append(dict(path=str(root.resolve()), usageSHA256=hashlib.sha256(raw).hexdigest(),
                                        estimatedUSD=usage['estimatedUSD'], calls=usage['calls'],
                                        unknownCallsReserved=usage['unknownCallsReserved']))
plan['priorIterationSpend'] = sum(p['estimatedUSD'] for p in plan['previousAttempts'])
plan['unknownReservationsPreserved'] = sum(p['unknownCallsReserved'] for p in plan['previousAttempts'])
plan.update(runtime='pi-harness-v1', schema='unioncity-pi-harness-v1', focusedDiagnosticOnly=attempt != 'full-v1',
            maxCalls={'answers': 1800, 'grading': plan['expectedBranches']},
            maxUSD={'answers': 10, 'grading': 2, 'pilotTotal': 12}, answerMaxOutputTokens=1600,
            accountingCapUSD=plan['priorIterationSpend'] + 12)
plan['changes'] = ['Pi AgentHarness tool dispatch and durable JSONL sessions', 'Independent skills; single agent with direct generic memory tools',
                   'Versioned request context and Pi compaction with source validation',
                   'Accounted JSON compatibility bridge, not native provider tool calling']
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(out)

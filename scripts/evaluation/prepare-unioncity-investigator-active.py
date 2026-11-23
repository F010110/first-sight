"""Three approved active-investigation cases under the user's updated cost instruction."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

attempt = sys.argv[1] if len(sys.argv) == 2 else 'v1'
if attempt not in {'v1', 'v2', 'full-v1', 'focused-v3'}:
    raise RuntimeError('Expected v1, v2 or full-v1')
full = attempt == 'full-v1'
source = Path('run/unioncity-investigator-pilot-v1-freeze' if attempt == 'focused-v3' else 'run/unioncity-repair-pilot-v2-freeze' if full else 'run/unioncity-investigator-smoke-v1-freeze')
out = Path('run/unioncity-investigator-pilot-v1-freeze' if full else f'run/unioncity-investigator-active-{attempt}-freeze')
plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
prior = []
roots = [Path(f'run/unioncity-organized-pilot-{version}-{lane}')
         for version in ['v1', 'v2', 'v3'] for lane in ['run1', 'score1']]
roots += [Path('run/unioncity-investigator-smoke-v1-run1'), Path('run/unioncity-investigator-recovery-v1-run1')]
if attempt in {'v2', 'full-v1', 'focused-v3'}:
    roots += [Path('run/unioncity-investigator-active-v1-run1'), Path('run/unioncity-investigator-active-v1-score1')]
if full or attempt == 'focused-v3':
    roots += [Path('run/unioncity-investigator-active-v2-run1'), Path('run/unioncity-investigator-active-v2-score1')]
if attempt == 'focused-v3':
    roots += [Path('run/unioncity-investigator-pilot-v1-run1'), Path('run/unioncity-investigator-pilot-v1-score1')]
for root in roots:
    raw = (root / 'requests/usage.json').read_bytes()
    usage = json.loads(raw)
    prior.append({'path': str(root.resolve()), 'usageSHA256': hashlib.sha256(raw).hexdigest(),
                  'estimatedUSD': usage['estimatedUSD'], 'calls': usage['calls'],
                  'unknownCallsReserved': usage['unknownCallsReserved']})
accounted = sum(p['estimatedUSD'] for p in prior)
shutil.copytree(source, out)
plan.update(schema=f'unioncity-active-investigator-{attempt}', questions=15 if full else 3, expectedBranches=37 if full else 3,
            normal=plan['normal'] if full else ['L07', 'L10', 'L25'], memoryDisabled=plan['memoryDisabled'] if full else [], suppliedEvidenceDiagnosticOnly=plan['suppliedEvidenceDiagnosticOnly'] if full else [],
            focusedDiagnosticOnly=not full, verifyTarget=False, previousAttempts=prior,
            priorIterationSpend=accounted, unknownReservationsPreserved=sum(p['unknownCallsReserved'] for p in prior),
            maxUSD={'answers': 5, 'grading': 1, 'pilotTotal': 6}, maxCalls={'answers': 384, 'grading': 3},
            accountingCapUSD=accounted + 6)
plan['budgetScope'] = 'User explicitly removed ordinary cost-based interruption for Qwen retesting. Historical estimates/reservations retained. USD6 is an emergency runaway guard, not an expected charge or quota claim.'
plan['costInterpretation'] = 'User reports free quota; estimates are not actual charges and remaining free quota is not independently verified.'
plan['full90Conditional'] = 'Focused diagnostics only; unchanged full 15-case quality and evidence gates are required before scale-up.'
plan['changes'] = ['Evidence checkpoints with new-source hypotheses and counterevidence',
                   'No delegator identity/time guesses forwarded to investigator',
                   'Text-first investigation; historical images only after inspect',
                   'Resumable investigations and active navigation; no direct locate']
if attempt in {'v2', 'full-v1'}:
    plan['changes'] += ['Field-specific reference validation feedback with counts and unavailable refs',
                        'Persistent navigation state and repeated-page feedback',
                        'Existence questions need two supported occurrences, not exhaustive third-visit exclusion']
if full:
    index = Path('run/unioncity-organized-index-v3/organized.sqlite').resolve()
    plan['organization'] = {'path': str(index), 'sha256': hashlib.sha256(index.read_bytes()).hexdigest(),
                            'scope': 'Read-only organization metadata; investigator reasons over exact causal source snapshots, not direct locate'}
    plan['maxCalls'] = {'answers': 1800, 'grading': 37}
    plan['maxUSD'] = {'answers': 10, 'grading': 2, 'pilotTotal': 12}
    plan['accountingCapUSD'] = accounted + 12
    plan['answerMaxOutputTokens'] = 1600
    plan['budgetScope'] = 'User removed ordinary Qwen cost interruption. USD12 is only a runaway emergency guard for this 37-branch pilot, not an expected charge or verified free quota.'
    plan['full90Conditional'] = 'Unchanged original 15-case semantic/channel/control gates plus actual-input and targeted source review are mandatory; this plan never directly starts 90 questions.'
    plan['changes'] += ['Typed ordinal anchorRefs and visits, separate from walking/observation events',
                        'Checkpoint still allows source recall/inspection to repair evidence gaps']
if attempt == 'focused-v3':
    plan.update(normal=['C01', 'S03', 'L01', 'L07', 'L16', 'L09', 'L23'], questions=7, expectedBranches=7,
                memoryDisabled=[], suppliedEvidenceDiagnosticOnly=[], focusedDiagnosticOnly=True,
                answerMaxOutputTokens=1600, maxCalls={'answers': 900, 'grading': 7})
    plan['changes'] += ['Bounded protocol feedback, empty persistent snapshot handling, explicit historical routing',
                        'Unknown omitted uncertainty and canonical read reference index']
    tasks = json.loads((out / 'tasks.json').read_text(encoding='utf-8'))
    raw = json.dumps([task for task in tasks if task['id'] in plan['normal']], ensure_ascii=False, indent=2).encode('utf-8')
    (out / 'tasks.json').write_bytes(raw)
    plan['tasksSHA256'] = hashlib.sha256(raw).hexdigest()
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'freeze': str(out), 'historicalEstimateIncludingReservations': accounted,
                  'unknownCallsPreserved': plan['unknownReservationsPreserved'], 'emergencyGuardUSD': plan['maxUSD']['pilotTotal']}))

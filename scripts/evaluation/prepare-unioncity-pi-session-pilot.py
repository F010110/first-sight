"""Question evaluation is admitted only after a complete new spatial session replay."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

mode = sys.argv[1] if len(sys.argv) > 1 else 'focused-v1'
if mode not in {'focused-v1', 'full-v1'}:
    raise RuntimeError('Expected focused-v1 or full-v1')
replay = Path(sys.argv[2] if len(sys.argv) > 2 else 'run/unioncity-pi-spatial-replay-v2')
receipt = json.loads((replay / 'complete.json').read_text(encoding='utf-8'))
if not receipt.get('complete') or receipt['completed'] != 813 or receipt['planned'] != 813:
    raise RuntimeError('Full 813-observation spatial replay must complete before questions')
source = Path('run/unioncity-investigator-pilot-v1-freeze' if mode == 'full-v1' else 'run/unioncity-investigator-generic-v1-freeze')
out = Path(f'run/unioncity-pi-session-{mode}-freeze')
checkpoints_raw = (replay / 'checkpoints.jsonl').read_bytes()
checkpoints = [json.loads(line) for line in checkpoints_raw.decode('utf-8').splitlines()]
if len(checkpoints) != 813 or len({c['observationId'] for c in checkpoints}) != 813:
    raise RuntimeError('Missing or duplicate spatial checkpoints')
by_id = {c['observationId']: c for c in checkpoints}
for checkpoint in checkpoints:
    raw = Path(checkpoint['contextPath']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != checkpoint['contextSHA256']:
        raise RuntimeError('Spatial context changed')
plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
accounting = json.loads(Path('run/unioncity-pi-harness-v3-freeze/plan.json').read_text(encoding='utf-8'))['previousAttempts']
roots = [Path('run/unioncity-pi-harness-v3-run1'), Path('run/unioncity-pi-spatial-replay-v1'),
         Path('run/unioncity-pi-spatial-state-prefix90-v1'), Path('run/unioncity-pi-spatial-state-prefix90-v2'),
         Path('run/unioncity-pi-spatial-state-prefix90-v3'), replay]
roots = list(dict.fromkeys(roots))
if mode == 'full-v1':
    roots += [Path('run/unioncity-pi-session-focused-v1-run1'), Path('run/unioncity-pi-session-focused-v1-score1')]
for root in roots:
    raw = (root / 'requests/usage.json').read_bytes()
    usage = json.loads(raw)
    accounting.append(dict(path=str(root.resolve()), usageSHA256=hashlib.sha256(raw).hexdigest(), estimatedUSD=usage['estimatedUSD'],
                           calls=usage['calls'], unknownCallsReserved=usage['unknownCallsReserved']))
shutil.copytree(source, out)
(out / 'session-snapshots').mkdir()
tasks = json.loads((out / 'tasks.json').read_text(encoding='utf-8'))
snapshots, bases = {}, {}
for task in tasks:
    checkpoint = by_id[task['currentObservationId']]
    if checkpoint['atMs'] != task['queryAtMs']:
        raise RuntimeError('Question time mismatch')
    bases[task['id']] = checkpoint
    prefix = checkpoints[:checkpoint['index']]
    snapshot = dict(asOfMs=checkpoint['atMs'], version=checkpoint['index'], pendingMemory=0, completeness='processed-not-verified', evidence=[],
                    results=[dict(lane='memory', observation_id=c['observationId'], source_at_ms=c['atMs'], evidence_until_ms=c['atMs'],
                                  available_at_ms=c['atMs'], memoryRef=c['memoryRef'], result={'summary': json.dumps(c['update'], ensure_ascii=False)}) for c in prefix])
    raw = json.dumps(snapshot, ensure_ascii=False, indent=2).encode('utf-8')
    path = out / 'session-snapshots' / f"{task['id']}.json"
    path.write_bytes(raw)
    snapshots[task['id']] = dict(path=str(path.resolve()), sha256=hashlib.sha256(raw).hexdigest())
raw = json.dumps(snapshots, ensure_ascii=False, indent=2).encode('utf-8')
(out / 'snapshots.json').write_bytes(raw)
plan['snapshotsSHA256'] = hashlib.sha256(raw).hexdigest()
raw = json.dumps(bases, ensure_ascii=False, indent=2).encode('utf-8')
(out / 'spatial-bases.json').write_bytes(raw)
plan['spatialReplay'] = dict(path=str(replay.resolve()), basesSHA256=hashlib.sha256(raw).hexdigest(), checkpointsSHA256=hashlib.sha256(checkpoints_raw).hexdigest(),
                             sessions=[dict(path=path, sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest()) for path in sorted({c['session']['path'] for c in checkpoints})])
plan.update(runtime='pi-harness-v1', schema='unioncity-pi-spatial-session-pilot-v1', focusedDiagnosticOnly=mode != 'full-v1',
            previousAttempts=accounting, priorIterationSpend=sum(p['estimatedUSD'] for p in accounting),
            unknownReservationsPreserved=sum(p['unknownCallsReserved'] for p in accounting),
            maxCalls={'answers': 1800, 'grading': plan['expectedBranches']}, maxUSD={'answers': 10, 'grading': 2, 'pilotTotal': 12}, answerMaxOutputTokens=1600)
plan['accountingCapUSD'] = plan['priorIterationSpend'] + 12
plan['changes'] = ['All 813 original triplets reprocessed into one chronological Pi spatial session',
                   'Normal question composes the exact per-time spatial module with its independent user-question session; no spatial fork',
                   'No old extracted facts or old 60-second context in normal question inputs',
                   'Disabled/supplied controls remain fresh no-history-session branches, not a mislabeled full-session no-tools ablation']
plan['knowledgeModel'] = 'Serial replay paused for every spatial update; available_at_ms is logical replay knowledge time, not wall-clock arrival or real-time throughput.'
(out / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
print(out)

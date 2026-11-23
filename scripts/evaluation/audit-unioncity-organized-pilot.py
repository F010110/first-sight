"""Offline request isolation, routing, spending and paired-score audit. Never alters a run."""
import hashlib
import json
import sys
from pathlib import Path

version = sys.argv[1] if len(sys.argv) == 2 else 'v1'
if version not in {'v1', 'v2', 'v3', 'investigator', 'recovery', 'active', 'active-v2', 'investigator-pilot'}:
    raise RuntimeError('Unexpected audit version')
base = 'unioncity-investigator-pilot-v1' if version == 'investigator-pilot' else 'unioncity-investigator-active-v2' if version == 'active-v2' else 'unioncity-investigator-active-v1' if version == 'active' else 'unioncity-investigator-recovery-v1' if version == 'recovery' else 'unioncity-investigator-smoke-v1' if version == 'investigator' else f'unioncity-organized-pilot-{version}'
root = Path(f'run/{base}-run1')
score = Path(f'run/{base}-score1')
out = Path(f'run/{base}-audit1')
out.mkdir(exist_ok=False)
load = lambda p: json.loads(p.read_text(encoding='utf-8'))
rows = [json.loads(s) for s in (root / 'results.jsonl').read_text(encoding='utf-8').splitlines()]
errors = []
plan = load(Path(f'run/{base}-freeze/plan.json'))
tasks = load(Path(f'run/{base}-freeze/tasks.json'))
snapshots = load(Path(f'run/{base}-freeze/snapshots.json'))
public = load(Path(plan['publicInputPath']))
observations = {r['id']: r for r in public['observations']}
hashed_images = {}
digest = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
if digest(plan['publicInputPath']) != plan['publicInputSHA256']:
    errors.append('Public input changed')
if digest(plan['organization']['path']) != plan['organization']['sha256']:
    errors.append('Frozen organization index changed')
for snapshot in snapshots.values():
    if digest(snapshot['path']) != snapshot['sha256']:
        errors.append(f"Snapshot changed: {snapshot['path']}")
calls = 0
normal_calls = 0
for p in sorted((root / 'requests').glob('*/input.json')):
    request = load(p)
    data = request['data']
    calls += 1
    reviewer = 'inspectedForReview' in data
    caps = data.get('capabilities', {'persistentMemory': True, 'organizedExperience': True, 'diagnosticSuppliedImages': False})
    at = data['current']['atMs']
    bindings = {r['alias']: r['originalId'] for r in request['metadata']['referenceBindings']}
    decode = lambda ref: bindings.get(ref, ref)
    current_id = decode(data['current']['id'])
    task = next(t for t in tasks if t['question'] == data['question'])
    snapshot = load(Path(snapshots[task['id']]['path']))
    allowed = {r['memoryRef']: r for r in snapshot['results'] if r['lane'] == 'memory' and r['source_at_ms'] < at - 60000}
    allowed_images = {current_id}
    if reviewer:
        delivered_ids = {decode(r['observationId']) for r in data['deliveredMemory']}
        for r in data['inspectedForReview']:
            original_id = decode(r['id'])
            if original_id not in delivered_ids:
                errors.append(f'{p}: reviewer image outside retrieved evidence')
            allowed_images.add(original_id)
    if caps['diagnosticSuppliedImages']:
        allowed_images.update(decode(r['id']) for r in data['diagnosticEvidence'])
    for h in data.get('history', data.get('retrievalTrace', [])):
        for r in h['result'].get('inspected', []):
            allowed_images.add(decode(r['observationId']))
    for image in request['images']:
        original_id = decode(image['id'])
        observation = observations.get(original_id)
        if original_id not in allowed_images or observation is None or observation['atMs'] > at:
            errors.append(f'{p}: unprovided or future image {original_id}')
        image_path = image['path']
        if image_path not in hashed_images:
            hashed_images[image_path] = hashlib.sha256(Path(image_path).read_bytes()).hexdigest()
        if hashed_images[image_path] != image['sha256']:
            errors.append(f'{p}: image hash mismatch')
    def check_result(v):
        if isinstance(v, dict):
            if 'memoryRef' in v and 'text' in v:
                original = allowed.get(v['memoryRef'])
                matches = original is not None and (original['result']['summary'].startswith(v['text']) if v.get('truncated') is True else original['result']['summary'] == v['text'])
                if not matches or original['source_at_ms'] != v.get('atMs'):
                    errors.append(f'{p}: result outside exact persistent snapshot')
            for x in v.values():
                check_result(x)
        elif isinstance(v, list):
            for x in v:
                check_result(x)
    for h in data.get('history', data.get('retrievalTrace', [])):
        check_result(h['result'])
    if caps['persistentMemory']:
        normal_calls += 1
        if not caps.get('organizedExperience') or data.get('diagnosticEvidence'):
            errors.append(f'{p}: normal capability or diagnostic contamination')
    def visit(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if k in {'expected', 'referenceObservations', 'referenceObservationIds', 'calibrationNotes', 'tier', 'targetEvidenceIds'}:
                    errors.append(f'{p}: private key {k}')
                if k in {'atMs', 'sourceAtMs'} and isinstance(x, (int, float)) and x > at:
                    errors.append(f'{p}: future timestamp {x}>{at}')
                visit(x)
        elif isinstance(v, list):
            for x in v:
                visit(x)
    visit(data)
    for r in data.get('recentContext', []):
        if not at - 60000 <= r['atMs'] <= at:
            errors.append(f'{p}: context boundary')

normal = [r for r in rows if r['mode'] == 'normal']
paths = []
for r in normal:
    if r['status'] != 'completed':
        paths.append({'id': r['id'], 'status': r['status'], 'error': r.get('error')})
        continue
    audit = r['answer']['audit']
    actions = [h['action'].get('kind') for h in audit['history']]
    if any(a in {'memory.search', 'memory.browse', 'memory.overview', 'memory.open'} for a in actions):
        errors.append(f"{r['id']}: attempted flat route")
    if any(m['atMs'] >= r['queryAtMs'] - 60000 for m in audit['deliveredMemory']):
        errors.append(f"{r['id']}: recent evidence in persistent delivery")
    paths.append({'id': r['id'], 'actions': actions, 'delivered': len(audit['deliveredMemory']),
                  'cited': r['answer']['memoryRefs'], 'abstained': r['answer']['abstained'], 'answer': r['answer']['text']})

usage = []
for p in [root / 'requests/usage.json', score / 'requests/usage.json']:
    if p.exists():
        usage.append({'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'usage': load(p)})

paired = []
if (score / 'grades.jsonl').exists():
    new = [json.loads(s) for s in (score / 'grades.jsonl').read_text(encoding='utf-8').splitlines()]
    old = [json.loads(s) for s in Path('run/unioncity-repair-pilot-v2-split-review1/split-reviews.jsonl').read_text(encoding='utf-8').splitlines()]
    if version in {'v2', 'v3', 'investigator', 'active', 'investigator-pilot'}:
        previous = 'v1' if version == 'v2' else 'v2'
        old = [json.loads(s) for s in Path(f'run/unioncity-organized-pilot-{previous}-score1/grades.jsonl').read_text(encoding='utf-8').splitlines()]
    if version == 'active-v2':
        old = [json.loads(s) for s in Path('run/unioncity-investigator-active-v1-score1/grades.jsonl').read_text(encoding='utf-8').splitlines()]
    for r in new:
        if r['mode'] == 'normal':
            baseline = next(x for x in old if x['id'] == r['id'] and x['mode'] == r['mode'])
            baseline_utility = baseline['score']['utility'] if 'score' in baseline else baseline['utility']
            paired.append({'id': r['id'], 'baselineUtility': baseline_utility, 'newUtility': r['utility'],
                           'semanticError': (r.get('split') or {}).get('semanticError'),
                           'mechanismError': (r.get('split') or {}).get('mechanismError')})
receipt = {'schema': 'organized-pilot-offline-audit-v1', 'requestCallsInspected': calls, 'normalCallsInspected': normal_calls, 'distinctImageFilesHashChecked': len(hashed_images),
           'errors': errors, 'paths': paths, 'pairedDevelopmentScores': paired, 'usage': usage,
           'limits': ['Timestamp/key audit is not proof of every semantic or image-boundary property',
                      'Paired grades use same-family stochastic judges, not independent gold',
                      'Supplied-image diagnostic scores excluded from normal comparisons']}
current_spend = sum(r['usage']['estimatedUSD'] for r in usage)
prior_spend = plan.get('priorIterationSpend', 0)
cap = plan.get('accountingCapUSD', .40)
receipt['iterationBudget'] = {'priorUSD': prior_spend, 'currentUSD': current_spend,
                              'cumulativeUSD': prior_spend + current_spend, 'capUSD': cap,
                              'unknownCallsReserved': plan.get('unknownReservationsPreserved', 0) + sum(r['usage']['unknownCallsReserved'] for r in usage)}
if prior_spend + current_spend > cap:
    errors.append('Cumulative iteration budget exceeded')
(out / 'audit.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'requests': calls, 'errors': errors, 'paired': paired}, ensure_ascii=False))

"""Read-only structural/source audit. Never certifies semantic truth or visual completeness."""
import hashlib
import json
import sys
from pathlib import Path

root, out = map(Path, sys.argv[1:3])
plan = json.loads((root / 'plan.json').read_text(encoding='utf-8'))
source_raw = Path(plan['inputPath']).read_bytes()
if hashlib.sha256(source_raw).hexdigest() != plan['inputSHA256']:
    raise RuntimeError('Original input changed')
observations = json.loads(source_raw)['observations']
by_id = {r['id']: r for r in observations}
checkpoints = [json.loads(s) for s in (root / 'checkpoints.jsonl').read_text(encoding='utf-8').splitlines()]
errors, historical_failures = [], []


def inspect_messages(messages, cutoff, location):
    for message in messages:
        content = message.get('content', [])
        if isinstance(content, str):
            try:
                data = json.loads(content)
            except (ValueError, TypeError):
                continue
            if isinstance(data, dict) and 'observationId' in data and data.get('atMs', cutoff) > cutoff:
                errors.append([location, 'future observation message'])
            continue
        if message.get('role') == 'toolResult' and message.get('toolName') == 'record_context' and not message.get('isError'):
            for block in content:
                if block.get('type') != 'text':
                    continue
                data = json.loads(block['text'])
                row = by_id.get(data.get('observationId'))
                if not row or row['atMs'] != data.get('atMs') or row['atMs'] > cutoff:
                    errors.append([location, 'invalid/future spatial source'])
        if message.get('role') == 'toolResult' and message.get('toolName') in {'finish', 'load_skill', 'decision'}:
            errors.append([location, 'question-agent operation in spatial session'])


for i, checkpoint in enumerate(checkpoints):
    row = observations[i]
    if checkpoint['index'] != i + 1 or checkpoint['memoryRef'] != f'memory-v{i + 1}' or checkpoint['observationId'] != row['id'] or checkpoint['atMs'] != row['atMs']:
        errors.append([i + 1, 'checkpoint/source order mismatch'])
    if checkpoint['update']['sourceIds'] != [row['id']]:
        errors.append([i + 1, 'update cites a different observation'])
    raw = Path(checkpoint['contextPath']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != checkpoint['contextSHA256']:
        errors.append([i + 1, 'context hash changed'])
    context = json.loads(raw)
    if context['atMs'] != row['atMs'] or context['observationId'] != row['id']:
        errors.append([i + 1, 'context clock mismatch'])
    inspect_messages(context['messages'], row['atMs'], f'context-{i + 1}')

request_count, summary_count = 0, 0
independent_observations = {}
for directory in sorted((root / 'requests').iterdir()):
    if not directory.is_dir() or not (directory / 'input.json').exists():
        continue
    request_count += 1
    request = json.loads((directory / 'input.json').read_text(encoding='utf-8'))
    data = request['data']
    row = by_id.get(data.get('current', {}).get('id'))
    if not row or row['atMs'] != data['current'].get('atMs'):
        errors.append([directory.name, 'request clock/source mismatch'])
        continue
    if request.get('phase') == 'perception':
        if set(data) != {'current'} or len(request['images']) != 3 or any(v['id'] != row['id'] for v in request['images']):
            errors.append([directory.name, 'independent perception received context or wrong imagery'])
        if {(v['path'], v['sha256']) for v in request['images']} != {(v['path'], v['sha256']) for v in row['views']}:
            errors.append([directory.name, 'independent image source/hash mismatch'])
        if (directory / 'response.txt').exists() and not (directory / 'failure.json').exists():
            body = json.loads((directory / 'response.txt').read_text(encoding='utf-8'))
            if body['choices'][0]['finish_reason'] == 'stop':
                independent_observations[row['id']] = json.loads(body['choices'][0]['message']['content'])['observations']
    elif data.get('role') == 'spatial-compaction':
        summary_count += 1
        if request['images']:
            errors.append([directory.name, 'summary unexpectedly receives imagery'])
    elif data.get('role') == 'pi-harness' and data.get('tools'):
        if {t['name'] for t in data['tools']} != {'record_context'}:
            errors.append([directory.name, 'spatial tool surface contains unrelated tools'])
        current_evidence = data.get('runtimeContext', {}).get('currentEvidence')
        if current_evidence:
            if request['images'] or current_evidence.get('sourceIds') != [row['id']] or current_evidence.get('observations') != independent_observations.get(row['id']):
                errors.append([directory.name, 'continuous spatial input differs from independent current evidence'])
        else:
            if len(request['images']) != 3 or any(image['id'] != row['id'] for image in request['images']):
                errors.append([directory.name, 'not exactly this observation triplet'])
            expected = {(v['path'], v['sha256']) for v in row['views']}
            if {(v['path'], v['sha256']) for v in request['images']} != expected:
                errors.append([directory.name, 'image source/hash binding changed'])
    else:
        historical_failures.append(dict(request=directory.name, reason='Default/unknown request route; retained for audit, not accepted spatial context'))
    inspect_messages(data.get('messages', []), row['atMs'], f'request-{directory.name}')
    if (directory / 'failure.json').exists():
        historical_failures.append(dict(request=directory.name, failure=json.loads((directory / 'failure.json').read_text(encoding='utf-8'))))

for checkpoint in checkpoints:
    if checkpoint['observationId'] in independent_observations and checkpoint['update']['observations'] != independent_observations[checkpoint['observationId']]:
        errors.append([checkpoint['index'], 'committed observations rewritten after independent inspection'])
complete = json.loads((root / 'complete.json').read_text(encoding='utf-8')) if (root / 'complete.json').exists() else {}
full = complete.get('complete') is True and len(checkpoints) == len(observations) == complete.get('completed')
receipt = dict(schema='pi-spatial-source-audit-v1', fullReplayComplete=full, checkpoints=len(checkpoints), planned=len(observations),
               requests=request_count, summaryRequests=summary_count, independentObservations=len(independent_observations), errors=errors, historicalFailures=historical_failures,
               structurallyValid=not errors, semanticQualityVerified=False, imageCoverageCertified=False,
               next='Inspect original imagery and summary drift before question evaluation; structure does not establish spatial correctness')
out.mkdir(exist_ok=False)
(out / 'audit.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(fullReplayComplete=full, checkpoints=len(checkpoints), errors=len(errors), historicalFailures=len(historical_failures))))

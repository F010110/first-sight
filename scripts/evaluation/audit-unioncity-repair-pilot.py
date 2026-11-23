"""Inspect actual pilot request envelopes without issuing model calls."""
import argparse
import hashlib
import json
from pathlib import Path


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def audit(freeze, run, output):
    freeze, run, output = map(Path, [freeze, run, output])
    if output.exists():
        raise FileExistsError(output)
    plan, report = load(freeze / 'plan.json'), load(run / 'report.json')
    tasks = {t['question']: t for t in load(freeze / 'tasks.json')}
    snapshots = load(freeze / 'snapshots.json')
    public = {r['id']: r for r in load(plan['publicInputPath'])['observations']}
    references = {r['id']: r for r in load(freeze / 'evaluation-only/references.json')}
    issues, counts, memory_calls = [], {}, {}
    forbidden = {'expected', 'calibrationNotes', 'referenceObservationIds', 'referenceObservations', 'correctAnswer', 'tier', 'segments', 'map', 'position'}

    def scan(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in forbidden:
                    issues.append({'kind': 'private-key-in-answer-request', 'key': key})
                scan(child)
        elif isinstance(value, list):
            for child in value:
                scan(child)

    for file in sorted((run / 'requests').glob('[0-9]*/input.json')):
        request = load(file)
        data = request['data']
        task = tasks[data['question']]
        when = task['queryAtMs']
        caps = data['capabilities']
        mode = 'normal' if caps['persistentMemory'] else 'supplied-evidence-diagnostic' if caps['diagnosticSuppliedImages'] else 'memory-disabled'
        key = task['id'] + ':' + mode
        first = key not in counts
        counts[key] = counts.get(key, 0) + 1
        scan(data)
        bindings = {b['alias']: b['originalId'] for b in request['metadata']['referenceBindings']}
        if bindings.get(data['current']['id']) != task['currentObservationId'] or data['current']['atMs'] != when:
            issues.append({'kind': 'wrong-current', 'case': key})
        if first and data['history']:
            issues.append({'kind': 'branch-history-not-empty', 'case': key})
        if mode != 'supplied-evidence-diagnostic' and data.get('diagnosticEvidence'):
            issues.append({'kind': 'oracle-in-nondiagnostic', 'case': key})
        oracle_allowed = {r['id'] for r in references[task['id']]['referenceObservations'] if r['atMs'] < when}
        for image in request['images']:
            source_id = bindings.get(image['id'])
            row = public.get(source_id)
            if row is None or row['atMs'] > when:
                issues.append({'kind': 'future-image', 'case': key})
            elif not any(v['sha256'] == image['sha256'] and v['direction'] == image['direction'] for v in row['views']):
                issues.append({'kind': 'wrong-image-binding', 'case': key})
            if mode == 'memory-disabled' and source_id != task['currentObservationId']:
                issues.append({'kind': 'raw-history-in-disabled', 'case': key})
            if mode == 'supplied-evidence-diagnostic' and source_id != task['currentObservationId'] and source_id not in oracle_allowed:
                issues.append({'kind': 'unexpected-oracle-image', 'case': key})
        snap = load(snapshots[task['id']]['path'])
        stored = {r['observation_id']: r for r in snap['results'] if r['lane'] == 'memory'}
        for fact in data['recentContext']:
            source_id = bindings.get(fact['observationId'])
            original = stored.get(source_id)
            if not original or fact['text'] != original['result']['summary'] or not when - 60000 <= fact['atMs'] <= when:
                issues.append({'kind': 'context-changed-or-noncausal', 'case': key})
        for step in data['history']:
            if str(step['action'].get('kind', '')).startswith('memory.'):
                memory_calls[key] = True
            if mode == 'memory-disabled' and step['result'].get('hits'):
                issues.append({'kind': 'old-memory-in-disabled', 'case': key})
            for hit in step['result'].get('hits', []):
                source_id = bindings.get(hit['observationId'])
                original = stored.get(source_id)
                if not original or original['result']['summary'] != hit['text'] or hit['atMs'] >= when - 60000:
                    issues.append({'kind': 'fabricated-or-noncausal-memory', 'case': key})
    for path, expected in load(run / 'implementation.json').items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected:
            issues.append({'kind': 'implementation-changed-since-launch', 'path': path})
    usage = load(run / 'requests/usage.json')
    previous = plan.get('previousAttempts', [])
    previous_usd = sum(v['estimatedUSD'] for v in previous)
    receipt = {'schema': 'unioncity-repair-input-audit-v1', 'passed': not issues, 'issues': issues,
               'requests': sum(counts.values()), 'cases': len(counts), 'normalPersistentRequestsInHistory': [key for key in memory_calls if key.endswith(':normal')],
               'sourceSnapshotsAndBaselineUnchanged': report['oldSnapshotsUnchanged'] and report['oldPublicInputUnchanged'] and report['oldResultsUnchanged'],
               'thisAttemptUsage': usage, 'priorPilotAnswerUSD': previous_usd,
               'cumulativePilotAnswerUSD': previous_usd + usage['estimatedUSD'],
               'originalUSD': .4142675579999991,
               'limitations': ['Structural input checks do not certify semantic correctness', 'Oracle images are privileged diagnostic evidence, never normal retrieval success']}
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('freeze')
    p.add_argument('run')
    p.add_argument('new_output')
    a = p.parse_args()
    print(json.dumps(audit(a.freeze, a.run, a.new_output), ensure_ascii=False))

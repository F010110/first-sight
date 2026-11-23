"""Audit recorded model inputs, time fences, branches and ledgers without model calls."""
import argparse
import hashlib
import json
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def audit(root, output):
    root, output = Path(root), Path(output)
    if output.exists():
        raise FileExistsError(output)
    tasks, public, plan, report = [load(root / name) for name in ['tasks.json', 'input.json', 'plan.json', 'report.json']]
    results = [json.loads(line) for line in (root / 'results.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    rows = {row['id']: row for row in public['observations']}
    task_by_text = {task['question']: task for task in tasks}
    issues, requests, ledgers, traces = [], [], [], {}
    blocked_keys = {'expected', 'referenceObservations', 'referenceAnswer', 'tier', 'correctAnswer', 'segments', 'map', 'position'}

    def scan(value, path=''):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in blocked_keys:
                    issues.append({'kind': 'private-field-in-request', 'key': path + '/' + key})
                scan(child, path + '/' + key)
        elif isinstance(value, list):
            for child in value:
                scan(child, path)

    for file in sorted((root / 'three-agent/question-requests').glob('[0-9]*/input.json')):
        request = load(file)
        data = request['data']
        task = task_by_text.get(data.get('question'))
        if task is None:
            issues.append({'kind': 'unknown-question', 'request': str(file)})
            continue
        ident, when = task['id'], task['queryAtMs']
        bindings = {b['alias']: b['originalId'] for b in request['metadata']['referenceBindings']}
        current_id = bindings.get(data['current']['id'])
        if current_id != task['currentObservationId'] or data['current']['atMs'] != when:
            issues.append({'kind': 'wrong-current-binding', 'id': ident})
        scan(data)
        for image in request['images']:
            ident_image = bindings.get(image['id'])
            row = rows.get(ident_image)
            if row is None or row['atMs'] > when:
                issues.append({'kind': 'future-or-unknown-image', 'id': ident})
            elif not any(v['sha256'] == image['sha256'] and v['direction'] == image['direction'] for v in row['views']):
                issues.append({'kind': 'image-hash-binding', 'id': ident})
        for item in data['recentContext']:
            source = bindings.get(item['observationId'])
            if source not in rows or rows[source]['atMs'] != item['atMs'] or not when - 60000 <= item['atMs'] <= when:
                issues.append({'kind': 'context-time-fence', 'id': ident})
        trace = traces.setdefault(ident, {'requests': 0, 'firstHistoryEmpty': None, 'initialContextHashes': set(), 'persistentRequested': False})
        if trace['requests'] == 0:
            trace['firstHistoryEmpty'] = data['history'] == []
            if data['history']:
                issues.append({'kind': 'branch-inherited-tool-history', 'id': ident})
        trace['requests'] += 1
        # Aliases can change across turns; compare source-independent contextRef/text/time.
        context = [(v['contextRef'], v['atMs'], v['text']) for v in data['recentContext']]
        trace['initialContextHashes'].add(hashlib.sha256(json.dumps(context, ensure_ascii=False).encode()).hexdigest())
        for step in data['history']:
            if str(step['action'].get('kind', '')).startswith('memory.'):
                trace['persistentRequested'] = True
            for hit in step.get('result', {}).get('hits', []):
                if hit['atMs'] >= when - 60000:
                    issues.append({'kind': 'persistent-return-in-recent-window', 'id': ident})
        requests.append({'id': ident, 'path': str(file), 'images': len(request['images'])})
    for ident, trace in traces.items():
        if len(trace['initialContextHashes']) != 1:
            issues.append({'kind': 'initial-context-changed-within-question', 'id': ident})
        trace['initialContextHashes'] = sorted(trace['initialContextHashes'])
    for path in sorted((root / 'three-agent').glob('*/usage.json')):
        usage = load(path)
        ledgers.append({'lane': path.parent.name, **usage})
    if len(results) != 90 or len({r['id'] for r in results}) != 90:
        issues.append({'kind': 'incorrect-result-count'})
    if report['progress']['completed'] != 813 or report['observations'] != 813:
        issues.append({'kind': 'incomplete-visual-memory'})
    for path, expected in plan['implementation'].items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected:
            issues.append({'kind': 'implementation-changed', 'path': path})
    tiers = {}
    for tier in 'CSL':
        selected = [r for r in results if r['id'].startswith(tier)]
        tiers[tier] = {'planned': len(selected), 'completed': sum(r['status'] == 'completed' for r in selected),
                       'failed': [r['id'] for r in selected if r['status'] != 'completed'],
                       'persistentRequestedInRecordedHistory': sum(traces.get(r['id'], {}).get('persistentRequested', False) for r in selected),
                       'finalMemoryRefsCited': sum(bool(r.get('answer', {}).get('memoryRefs')) for r in selected),
                       'finalContextRefsCited': sum(bool(r.get('answer', {}).get('contextRefs')) for r in selected),
                       'neitherContextNorMemoryCited': [r['id'] for r in selected if r['status'] == 'completed'
                                                      and not r['answer'].get('contextRefs') and not r['answer'].get('memoryRefs')]}
    receipt = {'schema': 'unioncity-questions90-input-audit-v1', 'passedStructuralChecks': not issues,
               'questions': len(results), 'questionRequests': len(requests), 'observations': report['observations'],
               'wallElapsedMs': report['wallElapsedMs'], 'issues': issues, 'tiers': tiers, 'ledgers': ledgers,
               'calls': sum(v['calls'] for v in ledgers), 'estimatedUSD': sum(v['estimatedUSD'] for v in ledgers),
               'unknownCallsReserved': sum(v['unknownCallsReserved'] for v in ledgers), 'questionTraces': traces,
               'limitations': ['Structural logs cannot establish semantic context coverage or absence of semantic leakage',
                               'Persistent-request count includes failed questions if prior tool actions reached subsequent model inputs',
                               'First empty history validates branch protocol, not all possible implementation bugs',
                               'Main-run cost only; separate semantic grading has its own capped ledger']}
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    return {k: v for k, v in receipt.items() if k not in ['questionTraces', 'ledgers']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run')
    parser.add_argument('new_output')
    args = parser.parse_args()
    print(json.dumps(audit(args.run, args.new_output), ensure_ascii=False))

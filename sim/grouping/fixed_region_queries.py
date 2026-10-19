"""Frozen query inventory; retrospective old/new recognition, labels scoring only."""
import argparse
import hashlib
import json
from pathlib import Path


def score_queries(contract, snapshots, horizon_ms=None):
    if not snapshots:
        raise ValueError('Empty snapshots')
    last_time = -1
    previous = set()
    for snapshot in snapshots:
        if snapshot['atMs'] <= last_time or not previous <= set(snapshot['assignments']):
            raise ValueError('Unordered or forgotten prefix')
        last_time = snapshot['atMs']; previous = set(snapshot['assignments'])
    labels = contract['labels']
    if set(labels) != previous:
        raise ValueError('Query inventory differs from replay')
    events = []
    for query in contract['queries']:
        arrival = next((i for i, s in enumerate(snapshots) if query['id'] in s['assignments']), None)
        if arrival is None or snapshots[arrival]['atMs'] != query['atMs']:
            raise ValueError('Query arrival differs')
        if horizon_ms is None:
            snapshot = snapshots[-1]
        else:
            # Never consume a prefix beyond the declared observation budget.
            eligible = [s for s in snapshots[arrival:] if s['atMs'] <= query['atMs'] + horizon_ms]
            snapshot = eligible[-1]
        chosen = snapshot['assignments'][query['id']]
        members = [id for id, group in snapshot['assignments'].items() if group == chosen] if chosen else []
        known = {labels[id] for id in members if labels[id] is not None}
        historical = set(query['historicalIds']) & set(members)
        if chosen is None:
            result = 'unknown'
        elif known != {query['label']}:
            result = 'wrong-region'
        elif query['scenario'] == 'old' and not historical:
            result = 'duplicate-new'
        elif query['scenario'] == 'new' and historical:
            result = 'wrong-old'
        else:
            result = 'correct'
        events.append({**query, 'evaluatedAtMs': snapshot['atMs'], 'availableDelayMs': snapshot['atMs'] - query['atMs'], 'groupId': chosen, 'result': result, 'unreviewedTargetMembers': [id for id in members if labels[id] is None]})
    def summarize(rows):
        correct = sum(row['result'] == 'correct' for row in rows)
        return {'total': len(rows), 'correct': correct, 'accuracy': correct / len(rows) if rows else None,
                'outcomes': {name: sum(row['result'] == name for row in rows) for name in ['correct', 'wrong-region', 'duplicate-new', 'wrong-old', 'unknown']}}
    return {'overall': summarize(events), 'old': summarize([r for r in events if r['scenario'] == 'old']), 'new': summarize([r for r in events if r['scenario'] == 'new']), 'events': events}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('baseline', type=Path); parser.add_argument('repaired', type=Path)
    parser.add_argument('labels', type=Path); parser.add_argument('contract', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args()
    read = lambda path: json.loads(path.read_text(encoding='utf-8'))
    baseline, repaired, review = map(read, [args.baseline, args.repaired, args.labels])
    snapshots = baseline['online']['snapshots']
    other_snapshots = repaired['online']['snapshots']
    if len(snapshots) != len(other_snapshots) or any(a['atMs'] != b['atMs'] or set(a['assignments']) != set(b['assignments']) for a, b in zip(snapshots, other_snapshots)):
        raise ValueError('Runs have different arrival inventories/timestamps')
    ids = list(snapshots[-1]['assignments'])
    labels = {id: None for id in ids}
    for row in review['labels']:
        if row['kind'] == 'core' and len(row['regions']) == 1:
            labels[row['observationId']] = row['regions'][0]
    queries, past = [], []
    for snapshot in snapshots:
        arrived = [id for id in snapshot['assignments'] if id not in past]
        if len(arrived) != 1:
            raise ValueError('Require one arrived observation per snapshot')
        id = arrived[0]
        if labels[id] is not None:
            queries.append({'id': id, 'atMs': snapshot['atMs'], 'label': labels[id], 'scenario': 'old' if any(labels[p] == labels[id] for p in past) else 'new', 'historicalIds': [p for p in past if labels[p] is not None]})
        past.append(id)
    contract = {'protocol': 'fixed-region-queries-v1', 'labelsSha256': hashlib.sha256(args.labels.read_bytes()).hexdigest(), 'labels': labels, 'queries': queries,
                'policy': 'Earlier reviewed observations are fixed history anchors, scored using their revised membership. Old target requires a same-group historical anchor and no reviewed other-region members; no majority-label mapping. Excluded members reported, not certified. New/old scenarios independent of predictions. Query set is development core images, not random spatial sampling or clean-history-conditioned recognition.'}
    if args.contract.exists():
        if read(args.contract) != contract:
            raise ValueError('Frozen contract differs; do not overwrite')
    else:
        args.contract.write_text(json.dumps(contract, ensure_ascii=False, indent=2), encoding='utf-8')
    digest = hashlib.sha256(args.contract.read_bytes()).hexdigest()
    result = {'protocol': 'fixed-region-query-report-v1', 'contractSha256': digest, 'inputs': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.baseline, args.repaired]}, 'runs': {},
              'limitations': 'AI-reviewed development labels, not independent held-out reliability. Final evaluation permits full future evidence; 10s near recording end has truncated context. Correct means correct on reviewed members, not certification of excluded images. Real temporal history matches remain separate from scored group reuse.'}
    for name, replay in [('baseline', baseline), ('optional-repair', repaired)]:
        result['runs'][name] = {mode: score_queries(contract, replay['online']['snapshots'], budget) for mode, budget in [('arrival', 0), ('delay10s', 10000), ('final', None)]}
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps({name: {mode: score['overall'] for mode, score in modes.items()} for name, modes in result['runs'].items()}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

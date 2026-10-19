"""Offline completion audit. Does not grade semantics or call a model."""
import argparse
import hashlib
import json
import sqlite3
from collections import Counter
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding='utf8'))


def audit(root, replay, output):
    if output.exists():
        raise ValueError('Never overwrite a previous audit')
    plan = load(root / 'plan.json')
    complete = load(root / 'complete.json')
    source_bytes = replay.read_bytes()
    assert hashlib.sha256(source_bytes).hexdigest() == plan['replaySha256']
    sources = [json.loads(line) for line in source_bytes.decode().splitlines() if line.strip()]
    records = [json.loads(line) for line in (root / 'results.jsonl').read_text(encoding='utf8').splitlines()]
    assert len(records) == complete['windows'] == plan['windows']
    assert [r['window'] for r in records] == list(range(len(records)))
    ids = [key for record in records for key in record['ids']]
    assert len(ids) == len(set(ids)) == complete['observations'] == plan['observations']
    assert ids == [r['id'] for r in sources[:len(ids)]]
    for name, expected in plan['files'].items():
        name = name[1:] if len(name) > 2 and name[0] == '/' and name[2] == ':' else name
        assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name
    assert all(r['result']['status'] in ['observed', 'answered'] for r in records)
    questions = [r for r in records if r['question'] is not None]
    assert [r['window'] for r in questions] == plan['questionWindows']
    if plan['historical']:
        for record in questions:
            assert record['result']['status'] == 'answered'
            assert any(key not in record['ids'] and not key.startswith('model-output:')
                       for key in record['result']['sourceIds'])
    db = sqlite3.connect((root / 'memory.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        assert db.execute('select count(*) from observations where pending=1').fetchone()[0] == 0
        assert db.execute('select count(*) from assignments').fetchone()[0] == len(ids)
        assert db.execute('select count(*) from observations').fetchone()[0] == len(ids)
        unknown = db.execute('select count(*) from assignments where place_id is null').fetchone()[0]
        statuses = Counter()
        for (raw,) in db.execute('select raw from model_outputs'):
            statuses[json.loads(raw).get('status', 'unclassified')] += 1
    finally:
        db.close()
    usage = load(root / 'requests/usage.json')
    assert usage['estimatedUSD'] <= usage['maxEstimatedUSD']
    result = {'status': 'offline-structural-audit-passed-not-semantic-score',
              'observations': len(ids), 'windows': len(records),
              'codeFreezeVerified': True, 'chronologicalCoverageVerified': True,
              'counts': complete['counts'], 'unknownAssignments': unknown,
              'questionExecutions': len(questions), 'modelOutputRecordStatuses': dict(statuses),
              'usage': usage, 'ninetyQuestionScore': None,
              'limitations': 'No place-identity correctness, region boundaries, or 90-question accuracy is established by structural completion.'}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('root', type=Path)
    p.add_argument('replay', type=Path); p.add_argument('output', type=Path)
    args = p.parse_args(); audit(args.root, args.replay, args.output)

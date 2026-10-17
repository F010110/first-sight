"""Independent, immutable RGB evidence archive; no topology assignments or model calls."""
import argparse
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

VIEWS = ('front', 'left', 'right')

def build(source, output):
    source = source.resolve()
    output.mkdir(parents=True, exist_ok=False)
    db = sqlite3.connect(output / 'evidence.sqlite')
    try:
        db.execute('CREATE TABLE observations(seq INTEGER PRIMARY KEY, id TEXT UNIQUE, session TEXT, at_ms REAL, raw TEXT)')
        db.execute('CREATE INDEX scope_time ON observations(session,at_ms,seq)')
        count = 0
        with (source / 'observations.jsonl').open(encoding='utf8') as stream:
            for line in stream:
                row = json.loads(line)
                if not isinstance(row['id'], str) or not row['id'] or not isinstance(row['sessionId'], str) or not row['sessionId']:
                    raise ValueError('Invalid identity/scope')
                at = row['atMs']
                if isinstance(at, bool) or not isinstance(at, (int, float)) or not 0 <= at < 1e16:
                    raise ValueError('Invalid timestamp')
                count += 1
                # Whitelist fields: never copy poses, labels, tasks, assignments or other truth.
                item = {'id': row['id'], 'sessionId': row['sessionId'], 'atMs': at, 'cameras': {}, 'sha256': {}}
                for view in VIEWS:
                    path = (source / row['cameras'][view]).resolve()
                    images = (source / 'images').resolve()
                    if not path.is_relative_to(images) or path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
                        raise ValueError('Only source images/ media are allowed')
                    digest = hashlib.sha256()
                    with path.open('rb') as image:
                        for block in iter(lambda: image.read(1024 * 1024), b''):
                            digest.update(block)
                    checksum = digest.hexdigest()
                    if row.get('sha256', {}).get(view) != checksum:
                        raise ValueError('Source hash mismatch')
                    relative = Path('images') / f'{count:08d}-{view}{path.suffix.lower()}'
                    destination = output / relative
                    destination.parent.mkdir(exist_ok=True)
                    shutil.copyfile(path, destination)
                    item['cameras'][view] = relative.as_posix()
                    item['sha256'][view] = checksum
                db.execute('INSERT INTO observations VALUES(?,?,?,?,?)', (count, item['id'], item['sessionId'], at, json.dumps(item)))
        db.commit()
        (output / 'complete.json').write_text(json.dumps({'observations': count, 'images': count * 3, 'modelCalls': 0, 'assignsPlaceIdentity': False, 'version': 1}), encoding='utf8')
        return count
    except Exception:
        db.rollback()
        # Preserve incomplete output for failure inspection; readers require complete.json.
        raise
    finally:
        db.close()

def page(archive, session, before_ms, after_seq=0, limit=20):
    if not session or not 0 < limit <= 100 or after_seq < 0 or not 0 <= before_ms < 1e16:
        raise ValueError('Invalid bounded query')
    if not (archive / 'complete.json').is_file():
        raise ValueError('Incomplete archive')
    db = sqlite3.connect((archive / 'evidence.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        rows = db.execute('SELECT seq,raw FROM observations WHERE session=? AND at_ms<? AND seq>? ORDER BY seq LIMIT ?', (session, before_ms, after_seq, limit)).fetchall()
        return {'observations': [json.loads(raw) for _, raw in rows], 'nextCursor': rows[-1][0] if rows else after_seq}
    finally:
        db.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('build'); create.add_argument('source', type=Path); create.add_argument('output', type=Path)
    query = commands.add_parser('page'); query.add_argument('archive', type=Path); query.add_argument('--session', required=True); query.add_argument('--before-ms', required=True, type=float); query.add_argument('--after-seq', type=int, default=0); query.add_argument('--limit', type=int, default=20)
    args = parser.parse_args()
    if args.command == 'build':
        print(json.dumps({'archivedObservations': build(args.source, args.output)}))
    else:
        print(json.dumps(page(args.archive, args.session, args.before_ms, args.after_seq, args.limit)))

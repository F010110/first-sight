"""Bounded offline-descriptor cache adapter. Verify current image bytes before reuse."""
import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path
from salad_features import sha, local_path

def build(features, output):
    report = json.loads((features / 'complete.json').read_text())
    if sha(features / 'features.jsonl') != report['featuresSha256']: raise ValueError('Feature file hash mismatch')
    output.mkdir(parents=True, exist_ok=False)
    db = sqlite3.connect(output / 'features.sqlite')
    try:
        db.execute('CREATE TABLE features(id TEXT PRIMARY KEY, raw TEXT NOT NULL)')
        count = 0
        with (features / 'features.jsonl').open() as stream:
            for line in stream:
                row = json.loads(line)
                if len(row['features']) != len(row['imageSha256']) or not 1 <= len(row['features']) <= 4: raise ValueError('Image/feature mismatch')
                for vector in row['features']:
                    if len(vector) != report['dimensions'] or not all(math.isfinite(x) for x in vector) or not any(vector): raise ValueError('Invalid descriptor')
                db.execute('INSERT INTO features VALUES(?,?)', (row['id'], json.dumps(row))); count += 1
        db.commit()
        (output / 'complete.json').write_text(json.dumps({**report, 'cachedObservations': count}, indent=2))
    finally: db.close()

def extract(cache, rows):
    if not (cache / 'complete.json').is_file(): raise ValueError('Incomplete descriptor cache')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100 or len({r['id'] for r in rows}) != len(rows): raise ValueError('Invalid bounded batch')
    db = sqlite3.connect((cache / 'features.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        result = []
        for row in rows:
            record = db.execute('SELECT raw FROM features WHERE id=?', (row['id'],)).fetchone()
            if record is None: raise ValueError('Observation absent from offline cache; cannot fabricate features')
            value = json.loads(record[0])
            if not 1 <= len(row['frames']) <= 4 or [sha(Path(local_path(p))) for p in row['frames']] != value['imageSha256']: raise ValueError('Cached descriptor image binding mismatch')
            result.append({'id': row['id'], 'features': value['features']})
        return result
    finally: db.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('build'); create.add_argument('features', type=Path); create.add_argument('output', type=Path)
    query = commands.add_parser('extract'); query.add_argument('cache', type=Path)
    args = parser.parse_args()
    if args.command == 'build': build(args.features, args.output)
    else: print(json.dumps(extract(args.cache, json.load(sys.stdin))))

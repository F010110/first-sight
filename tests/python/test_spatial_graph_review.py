import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from sim.review.build_spatial_graph_review import build


class GraphReviewTest(unittest.TestCase):
    def test_native_poses_are_review_only_and_original_inputs_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / 'images'; images.mkdir()
            image = images / 'frame.png'; image.write_bytes(b'original')
            sha = hashlib.sha256(image.read_bytes()).hexdigest()
            rows, truth, samples = [], [], []
            for i, (x, place) in enumerate([(0, 'a'), (.4, 'b'), (1.2, 'b')]):
                uid = 'native/world/route/' + str(i)
                key = hashlib.sha256(uid.encode()).hexdigest()[:24]
                cameras = {view: 'frame.png' for view in ['front', 'left', 'right']}
                hashes = {view: sha for view in cameras}
                rows.append({'id': key, 'atMs': i*2000, 'sourceAtMs': i*2000, 'episodeNumber': 1, 'sha256': hashes})
                samples.append({'id': key, 'cameras': cameras, 'sha256': hashes})
                truth.append({'observationId': key, 'sourceFrameUid': uid, 'sourcePose': [x, 0, 1, 0, 0, 0, 1]})
            (images / 'data.json').write_text(json.dumps({'samples': samples}))
            replay = root / 'replay.jsonl'; replay.write_text('\n'.join(map(json.dumps, rows)))
            native = root / 'truth.jsonl'; native.write_text('\n'.join(map(json.dumps, truth)))
            dbpath = root / 'memory.sqlite'; db = sqlite3.connect(dbpath)
            db.executescript('create table places(id text,raw text);create table assignments(observation_id text,raw text);create table transitions(from_observation_id text,to_observation_id text,from_place text,to_place text);')
            for place in ['a', 'b']:
                db.execute('insert into places values(?,?)', (place, json.dumps({'summary': place})))
            for i, row in enumerate(rows):
                db.execute('insert into assignments values(?,?)', (row['id'], json.dumps({'placeId': 'a' if i == 0 else 'b', 'reason': 'model statement'})))
            db.commit(); db.close()
            before = dbpath.read_bytes()
            output = root / 'review'
            report = build(dbpath, replay, native, images, output)
            self.assertEqual(report['places'], 2)
            data = json.loads((output / 'data.json').read_text(encoding='utf8'))
            self.assertEqual([p['xyz'] for p in data['samples']], [r['sourcePose'][:3] for r in truth])
            self.assertTrue(data['suspicions'])
            self.assertEqual(dbpath.read_bytes(), before)
            self.assertNotIn('floorId', data['samples'][0])
            with self.assertRaises(ValueError): build(dbpath, replay, native, images, output)


if __name__ == '__main__': unittest.main()

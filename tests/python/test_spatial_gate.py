import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from sim.spatial.prepare_spatial_gate import prepare

class GateTests(unittest.TestCase):
    def test_static_heartbeat_and_cumulative_change_without_ground_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';source.mkdir();rows=[]
            for i in range(21):
                # Static first 30s; then a large change, without any pose/room input.
                name=f'{i}.png';Image.new('RGB',(16,16),'white' if i>=18 else 'black').save(source/name)
                rows.append({'id':str(i),'sessionId':'r1','atMs':i*2000,'cameras':{v:name for v in ['front','left','right']}})
            (source/'observations.jsonl').write_text('\n'.join(json.dumps(r) for r in rows))
            output=root/'output';prepare(source,output)
            trace=[json.loads(l) for l in (output/'gate-trace.jsonl').read_text().splitlines()]
            self.assertEqual(trace[0]['reason'],'first');self.assertEqual(trace[15]['reason'],'heartbeat');self.assertEqual(trace[18]['reason'],'novelty')
            self.assertEqual(sum(r['keep'] for r in trace),3)
            accepted=[json.loads(l) for l in (output/'observations.jsonl').read_text().splitlines()]
            self.assertTrue(accepted[-1]['flushAfter']);self.assertTrue(all((output/r['cameras']['front']).exists() for r in accepted))
            with self.assertRaises(FileExistsError):prepare(source,output)

if __name__=='__main__':unittest.main()

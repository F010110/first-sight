import json
import tempfile
import unittest
from pathlib import Path
from sim.evaluation.prepare_memory_evaluation import prepare

class EvaluationPreparationTests(unittest.TestCase):
    def test_preserves_episode_boundary_and_prevents_early_window_knowledge(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);sample=root/'sample';bank=root/'bank';sample.mkdir();(bank/'evaluation-only').mkdir(parents=True)
            rows=[{'id':str(i),'episodeId':'a' if i<5 else 'b','atMs':i*2000,'sourceAtMs':i*2000,'cameras':{'front':'images/f.png','left':'images/l.png','right':'images/r.png'}} for i in range(8)]
            (sample/'observations.jsonl').write_text('\n'.join(map(json.dumps,rows)))
            tasks=[{'id':str(i),'memoryTier':('current','short','long')[i//30],'answerable':True,'question':'private target','expectedAnswer':'DO NOT LEAK'} for i in range(90)]
            public=[{'id':str(i),'question':'visible question','queryAtMs':1,'currentObservationId':'0'} for i in range(90)]
            (bank/'evaluation-only'/'tasks.json').write_text(json.dumps(tasks));(bank/'model-questions.json').write_text(json.dumps(public));(bank/'manifest.json').write_text('{}')
            result=prepare(sample,bank,root/'prepared');self.assertEqual(result['windows'],3)
            replay=(root/'prepared'/'model-replay'/'observations.jsonl').read_text();self.assertNotIn('DO NOT LEAK',replay)
            out=[json.loads(l) for l in replay.splitlines()];self.assertEqual(out[0]['judgmentAvailableAtMs'],6000);self.assertTrue(out[4]['flushAfter']);self.assertEqual(out[5]['judgmentAvailableAtMs'],14000)
            self.assertNotIn('DO NOT LEAK',(root/'prepared'/'model-questions.json').read_text())

if __name__=='__main__':unittest.main()

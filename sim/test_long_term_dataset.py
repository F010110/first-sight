import json
from pathlib import Path
import tempfile
import unittest
from build_long_term_dataset import build
from evaluate_long_term_memory import evaluate


class DatasetTests(unittest.TestCase):
    def test_truth_isolation_independent_sessions_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for i in range(2):
                capture=root/f'capture{i}';capture.mkdir()
                (capture/'manifest.json').write_text(json.dumps({'sceneId':'building','license':'test-only'}))
                (capture/'collector-trace.json').write_text(json.dumps([{'timestampMs':0,'collectorRegionIndex':1,'position':[i,0,0]}]))
                (capture/'windows.jsonl').write_text(json.dumps({'timestampMs':0,'frame':'0.jpg'})+'\n')
                for camera in ['frames','left','right']:
                    (capture/camera).mkdir();(capture/camera/'0.jpg').write_bytes(b'fixture')
            spec=root/'spec.json';value={'buildings':[{'id':'building','split':'dev','sessions':[{'id':'s0','role':'initial','capture':'capture0'},{'id':'s1','role':'alternate-route','capture':'capture1'}]}]}
            spec.write_text(json.dumps(value));report=build(spec,root/'out')
            self.assertEqual(report['tasks'],1)
            task=json.loads((root/'out/evaluation-only/tasks.json').read_text())[0]
            score=evaluate(root/'out',[{'taskId':task['id'],'retrievedIds':['s0:0'],'calls':1,'tokens':10,'latencyMs':4}])
            self.assertEqual(score['recallAtK'],1)
            invalid=evaluate(root/'out',[{'taskId':task['id'],'retrievedIds':['s1:0']}])
            self.assertEqual(invalid['invalidScopePredictions'],1)
            public=(root/'out/observations.jsonl').read_text()
            for forbidden in ['roomId','position','buildingId','expectedEvidenceIds']:self.assertNotIn(forbidden,public)
            with self.assertRaises(ValueError):build(spec,root/'out')
            value['buildings'][0]['sessions'][1]['capture']='capture0';spec.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'Repeated trace'):build(spec,root/'duplicate')


if __name__=='__main__':unittest.main()

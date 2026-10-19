import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from sim.benchmarks.memoreval_protocol import export

class ProtocolTest(unittest.TestCase):
    def test_reference_and_controller_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'tasks').mkdir()
            task={'scene':'s','task':'t','experience':[{'skill_calls':[{'target':'SECRET_TARGET'}]}],'requests':[{'id':'q','instruction':'Recall book color','question':'Color?','reference_answer':'SECRET_ANSWER','reference_plan':[{'target':'SECRET_TARGET'}],'success':{'instance':'SECRET_INSTANCE'},'allowed_skills':['answer'],'max_steps':3}]}
            (root/'tasks'/'task.json').write_text(json.dumps(task))
            with patch('sim.benchmarks.memoreval_protocol.subprocess.check_output',return_value='revision'):
                report=export(root,root/'output')
            public=(root/'output'/'requests.jsonl').read_text()
            self.assertNotIn('SECRET',public);self.assertNotIn('skill_calls',public)
            request=json.loads(public);self.assertTrue(request['freshContext']);self.assertEqual(report['requests'],1)
            self.assertIn('SECRET_ANSWER',(root/'output'/'evaluation-only'/'truth.jsonl').read_text())
            self.assertIn('SECRET_TARGET',(root/'output'/'evaluation-only'/'experience-controller.jsonl').read_text())

if __name__=='__main__': unittest.main()

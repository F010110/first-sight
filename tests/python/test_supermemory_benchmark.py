import json
import tempfile
import unittest
from pathlib import Path
from sim.benchmarks.supermemory_benchmark import export,score,UNANSWERABLE

class SuperMemoryTests(unittest.TestCase):
    def test_truth_isolation_and_wrong_abstention_scoring(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.json';rows=[]
            for i in range(2):rows.append({'question_id':i,'subject':1,'question':'question','choices':['yes','no','vague',UNANSWERABLE],'correct_option_index':0 if i==0 else 3,'correct_answer':'yes' if i==0 else UNANSWERABLE,'is_answerable':i==0,'answer_evidence':{'SECRET':'truth'}})
            source.write_text(json.dumps(rows));output=root/'export';export(source,output)
            self.assertNotIn('SECRET',(output/'requests.jsonl').read_text());self.assertNotIn('answerable',(output/'requests.jsonl').read_text())
            pred=root/'predictions.jsonl';pred.write_text('\n'.join(json.dumps({'id':str(i),'choiceIndex':3}) for i in range(2)))
            r=score(output/'evaluation-only'/'truth.jsonl',pred,root/'score.json');self.assertEqual(r['qaAccuracy'],.5);self.assertEqual(r['wrongAbstentions'],1);self.assertEqual(r['answerableF1'],0);self.assertIsNone(r['qaMRR'])
            pred.write_text(json.dumps({'id':'0','choiceIndex':0}))
            with self.assertRaises(ValueError):score(output/'evaluation-only'/'truth.jsonl',pred,root/'bad.json')

if __name__=='__main__':unittest.main()

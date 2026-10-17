import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from score_identity_pairs import score

class PairTest(unittest.TestCase):
    def test_unknown_not_success_and_merge_split_separated(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);database=root/'memory.sqlite';db=sqlite3.connect(database)
            db.execute('CREATE TABLE assignments(observation_id TEXT,place_id TEXT)')
            db.executemany('INSERT INTO assignments VALUES(?,?)',[('a','p'),('b','q'),('c','p'),('d',None)]);db.commit();db.close()
            labels=root/'labels.json';labels.write_text(json.dumps({'pairs':[{'a':'a','b':'b','same':True},{'a':'a','b':'c','same':False},{'a':'d','b':'missing','same':True},{'a':'a','b':'c','same':True}]}))
            result=score(database,labels,root/'report.json')
            self.assertEqual(result['falseSplits'],1);self.assertEqual(result['falseMerges'],1);self.assertEqual(result['unknownOrUnassigned'],1);self.assertEqual(result['passed'],1)

if __name__=='__main__':unittest.main()

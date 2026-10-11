import unittest
from temporal_classification_standard import score

def run(labels,groups):
    ids=list(labels);obs=[{'id':id,'atMs':i+1} for i,id in enumerate(ids)]
    snapshots=[{'observationId':id,'atMs':i+1,'assignments':{p:groups[p] for p in ids[:i+1]}} for i,id in enumerate(ids)]
    return score(obs,snapshots,labels)

class StandardTests(unittest.TestCase):
    def test_correct_old_and_new(self):
        r=run({'a':'A','b':'B','c':'A'},{'a':'g1','b':'g2','c':'g1'})
        self.assertEqual(r['classification']['old']['accuracy'],1)
        self.assertEqual(r['classification']['new']['accuracy'],1)
        self.assertEqual(r['verdict'],'符合当前标注样本')
    def test_fragmentation_allowed_but_counted(self):
        r=run({'a':'A','b':'A','c':'A'},{'a':'x','b':'y','c':'x'})
        self.assertEqual(r['grouping']['mixedGroupCount'],0)
        self.assertEqual(r['grouping']['regions'][0]['groupCount'],2)
        self.assertEqual(r['classification']['old']['duplicateNew'],1)
        self.assertEqual(r['verdict'],'符合当前标注样本')
    def test_novel_region_wrongly_absorbed_is_failure(self):
        r=run({'a':'A','b':'B'},{'a':'x','b':'x'})
        self.assertEqual(r['classification']['new']['wrongOld'],1)
        self.assertEqual(r['verdict'],'不符合')
    def test_return_to_wrong_old_group(self):
        r=run({'a':'A','b':'B','c':'A'},{'a':'x','b':'y','c':'y'})
        self.assertEqual(r['classification']['old']['wrongOld'],1)
    def test_all_unknown_not_clean_success(self):
        r=run({'a':'A','b':'A'},{'a':None,'b':None})
        self.assertEqual(r['verdict'],'证据不足');self.assertEqual(r['grouping']['unassignedRate'],1)
    def test_unknown_history_not_existing_group(self):
        r=run({'a':'A','b':'A'},{'a':None,'b':'g'})
        self.assertEqual(r['classification']['new']['total'],2)
        self.assertEqual(r['classification']['old']['total'],0)
    def test_final_correction_cannot_erase_arrival_error(self):
        labels={'a':'A','b':'B','c':'A'};obs=[{'id':id,'atMs':i+1} for i,id in enumerate(labels)]
        snapshots=[{'observationId':'a','atMs':1,'assignments':{'a':'x'}},{'observationId':'b','atMs':2,'assignments':{'a':'x','b':'x'}},{'observationId':'c','atMs':3,'assignments':{'a':'x','b':'y','c':'x'}}]
        r=score(obs,snapshots,labels);self.assertEqual(r['grouping']['mixedGroupCount'],0)
        self.assertEqual(r['classification']['new']['wrongOld'],1);self.assertEqual(r['verdict'],'不符合')
    def test_future_and_missing_labels_rejected(self):
        with self.assertRaises(ValueError):score([{'id':'a','atMs':1}],[{'observationId':'a','atMs':1,'assignments':{'a':'x','future':'x'}}],{'a':'A'})
        with self.assertRaises(ValueError):score([{'id':'a','atMs':1}],[{'observationId':'a','atMs':1,'assignments':{'a':'x'}}],{})

if __name__=='__main__':unittest.main()

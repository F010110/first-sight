import unittest,copy
from grouping_benchmark import digest,evaluate,compare

def fixture():
    b={'protocol':'grouping-benchmark-v1','observations':[{'id':id,'atMs':i+1} for i,id in enumerate(['a','b','c'])],'pairs':[{'id':'same','a':'a','b':'b','relation':'same','frames':['a.jpg','b.jpg']},{'id':'different','a':'a','b':'c','relation':'different','frames':['a.jpg','c.jpg']}],'queries':[{'id':'q','query':'c','candidates':['a','b'],'relevant':['a'],'frames':['c.jpg']}],'review':{'independent':True,'heldOut':True},'policy':{'approved':True,'minSame':.8,'minDifferent':.8,'minRecognition':.8,'minCoverage':.8,'maxHarmfulChanges':0,'minPairsPerClass':1,'minQueries':1}}
    r={'protocol':'grouping-run-v1','benchmarkHash':digest(b),'mode':'online','algorithmCommit':'fixture','evidenceBudget':'fixed','snapshots':[{'observationId':'a','atMs':1,'assignments':{'a':'x'}},{'observationId':'b','atMs':2,'assignments':{'a':'x','b':'x'}},{'observationId':'c','atMs':3,'assignments':{'a':'x','b':'x','c':'y'}}],'retrieval':{'q':['a']}}
    return b,r

class BenchmarkTests(unittest.TestCase):
    def test_fixed_good_run_passes(self):
        b,r=fixture();self.assertEqual(evaluate(b,r)['verdict'],'通过')
    def test_identical_versions_tie(self):
        b,r=fixture();self.assertEqual(compare(b,r,r)['comparison'],'持平')
    def test_all_unknown_fails_not_perfect_stability(self):
        b,r=fixture()
        for s in r['snapshots']:s['assignments']={id:None for id in s['assignments']}
        r['retrieval']['q']=[];result=evaluate(b,r)
        self.assertEqual(result['verdict'],'证据不足');self.assertIn('同组恢复',result['observedFailures'])
    def test_all_merged_fails(self):
        b,r=fixture();r['snapshots'][-1]['assignments']['c']='x'
        self.assertEqual(evaluate(b,r)['verdict'],'不通过')
    def test_wrong_retrieval_fails(self):
        b,r=fixture();r['retrieval']['q']=['a','b'];self.assertEqual(evaluate(b,r)['metrics']['contentRecognition']['wrong'],1)
    def test_unreviewed_diagnostic_cannot_pass(self):
        b,r=fixture();b['review']['independent']=False;r['benchmarkHash']=digest(b)
        self.assertEqual(evaluate(b,r)['verdict'],'证据不足')
    def test_changed_policy_or_labels_invalidates_hash(self):
        b,r=fixture();b['policy']['minSame']=0
        with self.assertRaises(ValueError):evaluate(b,r)
    def test_different_budget_cannot_compare(self):
        b,r=fixture();other=copy.deepcopy(r);other['evidenceBudget']='oracle'
        with self.assertRaises(ValueError):compare(b,r,other)
    def test_future_missing_reordered_prefix_rejected(self):
        for kind in ['future','missing','order']:
            b,r=fixture()
            if kind=='future':r['snapshots'][0]['assignments']['c']='y'
            elif kind=='missing':del r['snapshots'][-1]['assignments']['a']
            else:r['snapshots'].reverse()
            with self.assertRaises(ValueError):evaluate(b,r)
    def test_duplicate_truth_rejected(self):
        b,r=fixture();b['pairs'].append(b['pairs'][0]);r['benchmarkHash']=digest(b)
        with self.assertRaises(ValueError):evaluate(b,r)
    def test_future_and_self_queries_rejected(self):
        b,r=fixture();b['queries'][0]['candidates'].append('c');r['benchmarkHash']=digest(b)
        with self.assertRaises(ValueError):evaluate(b,r)
    def test_group_renaming_not_instability(self):
        b,r=fixture();r['snapshots'][-1]['assignments']={'a':'renamed','b':'renamed','c':'other'}
        self.assertEqual(evaluate(b,r)['metrics']['stability']['harmfulChanges'],0)
    def test_contradictory_transitive_truth_rejected(self):
        b,r=fixture();b['pairs'].append({'id':'bridge','a':'b','b':'c','relation':'same','frames':[]});r['benchmarkHash']=digest(b)
        with self.assertRaises(ValueError):evaluate(b,r)
    def test_withdrawal_not_hidden_as_stability(self):
        b,r=fixture();r['snapshots'][-1]['assignments']['b']=None
        result=evaluate(b,r);self.assertEqual(result['metrics']['stability']['retractions'],1)
        self.assertIn('已确定关系撤回',result['observedFailures'])

if __name__=='__main__':unittest.main()

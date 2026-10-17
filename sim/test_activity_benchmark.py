import unittest
from score_activity_benchmark import WEIGHTS,CHALLENGES,evaluate,answer_hash

def fixture(abstain=False):
    tasks=[];pred=[];grades=[];receipts=[]
    for family in WEIGHTS:
        for i in range(2):
            qid=family+str(i);answerable=family!='unknown'
            tasks.append({'id':qid,'sampleId':'day','family':family,'answerable':answerable,'queryAtMs':100,'validEvidenceSets':[['right']] if answerable else [],'forbiddenEvidenceIds':['wrong-floor'],'challenges':list(CHALLENGES) if answerable else []})
            p={'id':qid,'answer':'unknown' if abstain or not answerable else 'correct','abstained':abstain or not answerable,'citations':[] if abstain or not answerable else ['right']};pred.append(p)
            grades.append({'id':qid,'answerSha256':answer_hash(p),'credit':1 if not answerable or not abstain else 0,'harm':0,'reviewed':True,'judgeType':'structured-exact'})
            receipts.append({'id':qid,'answerSha256':answer_hash(p),'inspectedIds':['right','wrong-floor','future']})
    corpus={'kind':'scorer-fixture','samples':[{'id':'day','scoreEligible':True,'annotationStatus':'independently-reviewed'}],'tasks':tasks,'observations':[{'id':'right','sampleId':'day','atMs':0},{'id':'wrong-floor','sampleId':'day','atMs':20},{'id':'future','sampleId':'day','atMs':100}]}
    return corpus,pred,grades,receipts

def rebind(p, grades, receipts):
    for row in grades+receipts:
        if row['id']==p['id']:row['answerSha256']=answer_hash(p)

class ActivityScoringTests(unittest.TestCase):
    def test_perfect_fixture_is_not_a_system_result(self):
        result=evaluate(*fixture());self.assertEqual(set(result['scores'].values()),{100});self.assertEqual(result['status'],'scorer-fixture-not-system-result')
        self.assertNotIn('coverage',result['scores']);self.assertEqual(len(result['scores']),3)

    def test_all_refusal_does_not_win_utility(self):
        r=evaluate(*fixture(True));self.assertEqual(r['scores']['实际问题解决'],15);self.assertEqual(r['scores']['长程与干扰'],0);self.assertEqual(r['scores']['回答可信'],100)

    def test_grouping_and_boundary_changes_have_no_direct_penalty(self):
        data=fixture();before=evaluate(*data)
        for p in data[1]:p['placeId']='arbitrary-renamed-or-split-node';p['boundaryOffset']=10
        self.assertEqual(before,evaluate(*data))

    def test_correct_answer_wrong_floor_is_not_success(self):
        corpus,pred,grades,receipts=fixture();pred[0]['citations']=['wrong-floor'];rebind(pred[0],grades,receipts)
        r=evaluate(corpus,pred,grades,receipts);self.assertLess(r['scores']['实际问题解决'],100);self.assertLess(r['scores']['回答可信'],100)
        self.assertEqual(r['diagnostics']['questions'][0]['utility'],0)

    def test_future_or_uninspected_citation_is_rejected_even_if_answer_matches(self):
        for citation in ['future','not-recorded']:
            corpus,pred,grades,receipts=fixture();pred[0]['citations']=[citation];rebind(pred[0],grades,receipts)
            r=evaluate(corpus,pred,grades,receipts);self.assertEqual(r['diagnostics']['questions'][0]['harm'],1);self.assertEqual(r['diagnostics']['questions'][0]['utility'],0)
        corpus,pred,grades,receipts=fixture();receipts[0]['inspectedIds']=[]
        self.assertEqual(evaluate(corpus,pred,grades,receipts)['diagnostics']['questions'][0]['utility'],0)

    def test_missing_prediction_is_not_removed(self):
        corpus,pred,grades,receipts=fixture();pred.pop(0);grades.pop(0);receipts.pop(0)
        r=evaluate(corpus,pred,grades,receipts);self.assertEqual(r['questions'],12);self.assertEqual(r['scores']['实际问题解决'],90)

    def test_unreviewed_or_missing_family_has_no_publishable_scores(self):
        corpus,pred,grades,receipts=fixture();corpus['samples'][0]['annotationStatus']='ai-initial'
        self.assertEqual(set(evaluate(corpus,pred,grades,receipts)['scores'].values()),{None})
        corpus,pred,grades,receipts=fixture();corpus['tasks']=[t for t in corpus['tasks'] if t['family']!='state'];ids={t['id'] for t in corpus['tasks']}
        r=evaluate(corpus,[p for p in pred if p['id'] in ids],[g for g in grades if g['id'] in ids],[t for t in receipts if t['id'] in ids]);self.assertEqual(r['status'],'not-ready')

    def test_grading_cannot_be_reused_for_another_answer(self):
        data=fixture();data[1][0]['answer']='changed'
        with self.assertRaisesRegex(ValueError,'grading'):evaluate(*data)

    def test_unmeasured_challenge_does_not_get_renormalized_to_full_marks(self):
        data=fixture()
        for t in data[0]['tasks']:t['challenges']=['long_gap','similar_places']
        r=evaluate(*data);self.assertIsNone(r['scores']['长程与干扰']);self.assertEqual(r['scores']['实际问题解决'],100)

    def test_unanswerable_guess_and_minor_detail_have_different_consequences(self):
        corpus,pred,grades,receipts=fixture();p=pred[-1];p.update(answer='made-up fact',abstained=False);rebind(p,grades,receipts)
        r=evaluate(corpus,pred,grades,receipts);self.assertEqual(r['diagnostics']['questions'][-1]['harm'],1);self.assertEqual(r['diagnostics']['questions'][-1]['utility'],0)
        data=fixture();data[2][0]['harm']=.25;r=evaluate(*data);self.assertEqual(r['scores']['实际问题解决'],100);self.assertLess(r['scores']['回答可信'],100)

if __name__=='__main__':unittest.main()

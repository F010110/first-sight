import unittest
from label_score_hssd_regions import score,validate


class LabelScoreTests(unittest.TestCase):
    def test_one_to_one_identity_alignment_penalizes_merges_unknowns_and_boundary(self):
        labels=[{'observationId':'a','kind':'core','regionIds':['R1']},{'observationId':'b','kind':'core','regionIds':['R2']},{'observationId':'c','kind':'boundary','regionIds':['R1','R2']}]
        report={'finalAssignments':{'a':'p','b':'p','c':None},'answer':{'regions':[{'groupIds':['G1']}],'boundaryGroups':[]}}
        result=score(labels,report,{'groups':{'G1':{'observationIds':['a','b']}}})
        self.assertEqual(result['internal']['correct'],1)
        self.assertEqual(result['internal']['accuracy'],.5)
        self.assertEqual(result['boundary']['accuracy'],0)

    def test_no_boundary_is_na_not_perfect(self):
        result=score([],{'finalAssignments':{},'answer':{'regions':[],'boundaryGroups':[]}},{'groups':{}})
        self.assertIsNone(result['boundary']['accuracy'])


if __name__=='__main__':unittest.main()

import unittest
from sim.context.dense_context_evidence import propose_contexts
from sim.grouping.run_grouping_only_ablation import metrics


class AblationTests(unittest.TestCase):
    def test_unconditional_anchor_is_only_experimental_and_still_requires_new_support(self):
        scores={(0,1):0,(2,3):1,(0,2):0,(0,3):0,(1,2):0,(1,3):0}
        match=lambda a,b:scores.get(tuple(sorted((a,b))))
        self.assertEqual(len(propose_contexts([0,1,2,3],500,match,'unconditional-first-pair')[0]),1)
        self.assertEqual(propose_contexts([0,1,2,3],500,match,'legacy-first-pair')[0],[])

    def test_purity_alone_does_not_reward_singletons_without_retention_cost(self):
        labels={'a':'R1','b':'R1','c':'R2'}
        merged=metrics([{'id':'g','observationIds':list(labels)}],labels)
        split=metrics([{'id':k,'observationIds':[k]} for k in labels],labels)
        self.assertEqual(merged['mixedGroups'],1)
        self.assertEqual(split['coreMajorityPurity'],1)
        self.assertEqual(split['sameRegionPairRetention'],0)


if __name__=='__main__':unittest.main()

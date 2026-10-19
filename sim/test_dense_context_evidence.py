import unittest
from dense_context_evidence import propose_contexts


class DenseContextTests(unittest.TestCase):
    def test_single_bridge_cannot_replace_context(self):
        table={(0,1):1,(2,3):1,(0,2):0,(0,3):.5,(1,2):0,(1,3):0,(4,5):1,(0,4):0,(0,5):0,(1,4):0,(1,5):0}
        events,_=propose_contexts(list(range(6)),500,lambda a,b:table.get(tuple(sorted((a,b)))))
        self.assertEqual(events[0]['oldTicks'],[0,1])
        self.assertEqual(events[0]['beforeTick'],4)
    def test_context_updates_before_confirming_later_candidate(self):
        table={(0,1):1,(1,2):1,(0,2):1,(3,4):1,(1,3):0,(1,4):0,(2,3):0,(2,4):0}
        compare=lambda a,b:table.get(tuple(sorted((a,b))))
        events,_=propose_contexts(list(range(5)),500,compare)
        self.assertEqual(events[0]['oldTicks'],[1,2])
        self.assertEqual(events[0]['beforeTick'],3)
        self.assertEqual(propose_contexts(list(range(4)),500,compare)[0],[])

    def evidence(self,missing=False,overlap=False):
        table={(2,3):1,(4,5):1,(2,4):0,(2,5):0,(3,4):0,(3,5):0}
        if missing: table[(3,5)]=None
        if overlap: table[(3,5)]=.8
        return lambda a,b:table.get(tuple(sorted((a,b))),0)

    def test_later_supported_anchors_recover_and_confirmation_is_causal(self):
        events,_=propose_contexts(list(range(6)),500,self.evidence())
        self.assertEqual(events[0]['beforeTick'],4)
        self.assertEqual(events[0]['confirmedTick'],5)
        self.assertEqual(propose_contexts(list(range(5)),500,self.evidence())[0],[])

    def test_missing_comparison_and_positive_overlap_do_not_cut(self):
        self.assertEqual(propose_contexts(list(range(6)),500,self.evidence(missing=True))[0],[])
        self.assertEqual(propose_contexts(list(range(6)),500,self.evidence(overlap=True))[0],[])

    def test_low_texture_and_gaps_cannot_authorize_departure(self):
        self.assertEqual(propose_contexts(list(range(6)),500,lambda a,b:0)[0],[])
        self.assertEqual(propose_contexts([0,1,2,3,10,11],500,self.evidence())[0],[])
        self.assertEqual(propose_contexts(list(range(6)),5000,self.evidence())[0],[])


if __name__=='__main__':unittest.main()

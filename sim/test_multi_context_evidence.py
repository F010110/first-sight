import unittest
from multi_context_evidence import propose_multi_contexts


class MultiContextTests(unittest.TestCase):
    def test_three_frame_candidate_confirmation_is_causal(self):
        scores={(0,1):1,(2,3):1,(3,4):1,(2,4):1}
        match=lambda a,b:scores.get(tuple(sorted((a,b))),0)
        self.assertEqual(propose_multi_contexts(list(range(4)),500,match)[0],[])
        events,_=propose_multi_contexts(list(range(5)),500,match)
        self.assertEqual(events[0]['beforeTick'],2)
        self.assertEqual(events[0]['confirmedTick'],4)

    def test_missing_comparison_does_not_cut(self):
        scores={(0,1):1,(2,3):1,(3,4):1,(2,4):1}
        self.assertEqual(propose_multi_contexts(list(range(5)),500,lambda a,b:scores.get(tuple(sorted((a,b)))))[0],[])

    def test_gap_resets_and_one_positive_bridge_does_not_move_context(self):
        scores={(0,1):1,(2,3):1,(3,4):1,(2,4):1,(0,3):.5}
        match=lambda a,b:scores.get(tuple(sorted((a,b))),0)
        self.assertEqual(propose_multi_contexts(list(range(5)),500,match)[0],[])
        self.assertEqual(propose_multi_contexts([0,1,8,9,10],500,match)[0],[])


if __name__=='__main__':unittest.main()

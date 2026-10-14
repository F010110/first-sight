import unittest
from hssd_chunking_trial import partition


class ChunkingTests(unittest.TestCase):
    def test_time_chunks_preserve_every_observation_and_bound_length(self):
        ids=[f'o{i}' for i in range(23)]
        for size in [2,4,6]:
            groups=partition(ids,size)
            self.assertEqual([x for g in groups for x in g],ids)
            self.assertLessEqual(max(map(len,groups)),size)

    def test_visual_caps_preserve_cuts_and_reject_missing_inventory(self):
        ids=list('abcdefghij');visual=[{'observationIds':ids[:3]},{'observationIds':ids[3:]}]
        self.assertEqual(partition(ids,4,visual),[ids[:3],ids[3:7],ids[7:]])
        with self.assertRaises(ValueError):partition(ids,4,visual[:1])


if __name__=='__main__':unittest.main()

import unittest
from sim.context.home_window_vlm_trial import blocks,validate,remember_reference


class WindowTests(unittest.TestCase):
    def test_revisited_reference_moves_to_recent_end(self):
        refs={'R1':'a','R2':'b','R3':'c','R4':'d'}
        remember_reference(refs,'R1','e')
        self.assertEqual(list(refs)[-3:],['R3','R4','R1'])
        self.assertEqual(refs['R1'],'e')
    def test_complete_contiguous_causal_partition(self):
        windows=[{'endTick':i*3} for i in range(1,21)]
        snapshots=[{'atMs':(i+1)*3000,'assignments':{f'observation-{j+1}':str(j//3) for j in range(i+1)}} for i in range(20)]
        for visual in [False,True]:
            plan=blocks(windows,snapshots,visual)
            self.assertEqual([oid for b in plan for oid in b['ids']],[f'observation-{i+1}' for i in range(20)])
            for b in plan:self.assertTrue(all(int(oid.split('-')[1])*3000<=b['closedAtMs'] for oid in b['ids']))

    def test_multiple_identities_in_one_block(self):
        validate({'places':[{'id':'R1','summary':'kitchen'},{'id':'R2','summary':'bedroom'}],'assignments':[{'observationId':'a','placeId':'R1','reason':'island'},{'observationId':'b','placeId':'R2','reason':'bed'}]},['a','b'],{})


if __name__=='__main__':unittest.main()

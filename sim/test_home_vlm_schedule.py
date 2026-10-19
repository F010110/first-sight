import unittest
from prepare_home_vlm_schedule import schedule


class SchedulingTests(unittest.TestCase):
    def test_causal_prefix_and_maximum_silence(self):
        windows=[{'endTick':i,'frame':str(i)} for i in range(1,41)]
        snapshots=[{'atMs':i*1000,'assignments':{f'observation-{j}':'g' for j in range(1,i+1)}} for i in range(1,41)]
        calls=schedule(windows,snapshots,True)
        self.assertEqual([c['scheduledAtMs'] for c in calls],[10000,30000])
        for call in calls:
            self.assertTrue(all(int(oid.split('-')[1])*1000<=call['scheduledAtMs'] for oid in call['selectedIds']))
        self.assertEqual(len(schedule(windows,snapshots,False)),4)

    def test_new_group_is_submitted_at_next_tick(self):
        windows=[{'endTick':i,'frame':str(i)} for i in range(1,31)]
        snapshots=[{'atMs':i*1000,'assignments':{f'observation-{j}':('a' if j<15 else 'b') for j in range(1,i+1)}} for i in range(1,31)]
        calls=schedule(windows,snapshots,True)
        self.assertEqual([c['scheduledAtMs'] for c in calls],[10000,20000])
        self.assertEqual(calls[1]['selectedIds'],['observation-15','observation-20'])


if __name__=='__main__':unittest.main()

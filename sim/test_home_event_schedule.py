import unittest
from prepare_home_event_schedule import events


class EventTests(unittest.TestCase):
    def fixture(self,groups):
        windows=[{'endTick':i*3} for i in range(1,len(groups)+1)]
        snapshots=[{'atMs':(i+1)*3000,'assignments':{f'observation-{j+1}':groups[j] for j in range(i+1)}} for i in range(len(groups))]
        return windows,snapshots

    def test_first_debounce_and_causal_evidence(self):
        calls,pending=events(*self.fixture(['a','b','b','b','a','a']))
        self.assertEqual([c['scheduledAtMs'] for c in calls],[3000,9000,18000])
        self.assertEqual([c['trigger'] for c in calls],['first','group-change','group-change'])
        for c in calls:self.assertTrue(all(int(oid.split('-')[1])*3000<=c['atMs'] for oid in c['selectedIds']))
        self.assertEqual(pending,[])

    def test_quiet_heartbeat_and_terminal_pending(self):
        calls,pending=events(*self.fixture(['a']*12))
        self.assertEqual([c['atMs'] for c in calls],[3000,33000])
        self.assertEqual(pending,['observation-12'])


if __name__=='__main__':unittest.main()

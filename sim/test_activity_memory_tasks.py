import unittest
from build_school_memory_tasks import compile_tasks,trajectory_map,select_inputs

def fixture():
    rows=[];obs=[];episodes=[];regions=['exterior','gym','hall','classroom','library']
    for ep in range(10):
        trajectory=f'P{ep:04d}';start=ep*1460000
        episodes.append({'id':trajectory,'startMs':start,'endMs':start+260000})
        for n,t in enumerate([0,20,26,40,60,80,100,120,140,160,177.5,180,200,220,240,260]):
            oid=f'{trajectory}-{t}';region=regions[n%5]
            if ep==7 and t==26:region=None
            rows.append({'observationId':oid,'trajectory':trajectory,'sourceAtMs':round(t*1000),'atMs':start+round(t*1000),'sourceFrameIndex':round(t*10),'sourceXYZ':[float(n),float(ep),-5. if ep==7 and t>=80 else 0.],'robotHeightM':1.5,'regionLabel':region,'status':'assistant-visual-anchor' if region else 'source-verified-semantic-unreviewed'})
            obs.append({'id':oid,'episodeId':trajectory,'atMs':start+round(t*1000)})
    return rows,obs,episodes

class MemoryHorizonTests(unittest.TestCase):
    def test_balanced_real_horizons_and_disjoint_facts(self):
        tasks,labels=compile_tasks(*fixture())
        self.assertEqual(len(tasks),90)
        for tier in ('current','short','long'):
            selected=[t for t in tasks if t['memoryTier']==tier]
            self.assertEqual(len(selected),30);self.assertEqual(sum(not t['answerable'] for t in selected),4)
            self.assertEqual(sum(t['memoryRequired'] for t in selected),0 if tier=='current' else 26)
        facts=[t['validEvidenceSets'][0][0] for t in tasks if t['family']=='recall']
        self.assertEqual(len(facts),70);self.assertEqual(len(set(facts)),70)
        for t in tasks:
            self.assertTrue(t['supportLabelIds']);self.assertTrue(all(k in labels for k in t['supportLabelIds']))
            if t['memoryRequired']:
                self.assertTrue(t['historyMustContainIds']);self.assertNotIn(t['currentObservationId'],t['historyMustContainIds'])
            if t['memoryTier']=='long' and t['memoryRequired']:
                self.assertGreaterEqual(t['historicalLagMs'],1200000);self.assertGreaterEqual(t['interveningObservations'],50);self.assertTrue(t['crossEpisode'])

    def test_source_level_constraint_not_based_on_semantic_similarity(self):
        tasks,labels=compile_tasks(*fixture());task=next(t for t in tasks if t['testedFeature']=='differentPhysicalLevel')
        self.assertEqual(task['expectedAnswer'],'不是同一物理层')
        rows,obs,episodes=fixture()
        for r in rows:r['sourceXYZ'][2]=0.
        with self.assertRaisesRegex(ValueError,'Different-level'):compile_tasks(rows,obs,episodes)

    def test_map_does_not_pretend_to_be_ground_truth_rooms(self):
        text=trajectory_map(fixture()[0]);self.assertIn('NOT a room/floor map',text);self.assertIn('Gaps are not connected',text)

    def test_memory_gold_is_not_accessible_to_current_only_or_future(self):
        rows,obs,episodes=fixture();tasks,_=compile_tasks(rows,obs,episodes)
        for t in tasks:
            for mode in ('current-only','recent-5min','full-history'):
                selected=select_inputs(t,obs,mode);ids={o['id'] for o in selected}
                self.assertTrue(all(o['atMs']<t['queryAtMs'] for o in selected))
                if mode=='current-only':self.assertEqual(ids,{t['currentObservationId']})
                if t['memoryRequired'] and (mode=='current-only' or mode=='recent-5min' and t['memoryTier']=='long'):
                    self.assertFalse(any(set(g)<=ids for g in t['validEvidenceSets']))
                if mode=='full-history' and t['answerable']:self.assertTrue(any(set(g)<=ids for g in t['validEvidenceSets']))

if __name__=='__main__':unittest.main()

import unittest
from sim.evaluation.prepare_full_memory_evaluation import pack

class FullMemoryTests(unittest.TestCase):
    def test_all_causal_images_no_future_judgments_or_reference_labels(self):
        rows=[{'id':str(i),'atMs':i*1000,'sourceAtMs':i*1000,'episodeNumber':1,'judgmentAvailableAtMs':5000 if i==1 else i*1000,'cameras':{v:f'{i}-{v}.png' for v in ('front','left','right')},'sha256':{}} for i in range(4)]
        assignments={str(i):{'placeId':'p','reason':'FUTURE' if i==1 else 'gym'} for i in range(4)}
        result=pack({'id':'q','question':'where','queryAtMs':2001,'currentObservationId':'2'},rows,assignments)
        self.assertEqual([r['id'] for r in result['observations']],['0','1','2'])
        self.assertEqual(sum(len(r['cameras']) for r in result['observations']),9)
        self.assertEqual(result['observations'][1]['reason'],'')
        self.assertIsNone(result['observations'][1]['placeId'])
        self.assertEqual(result['observations'][0]['reason'],'gym')

if __name__=='__main__':unittest.main()

"""Protocol/coverage tests only, not EgoLife user-task accuracy."""
import importlib.util
from pathlib import Path
import unittest

SPEC=importlib.util.spec_from_file_location('egolife_interface',Path(__file__).resolve().parents[2]/'scripts/evaluation/inspect-egolife-integration.py')
module=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(module)

class EgoLifeIntegration(unittest.TestCase):
    def test_clock_and_day(self):
        self.assertEqual(module.clock('DAY1','11210217'),{'untilTime':111210217,'cutoffMs':40862170})
        self.assertEqual(module.clock('DAY2','00000000')['cutoffMs'],86400000)
    def test_invalid_clock(self):
        with self.assertRaises(ValueError):module.clock('DAY1','23600000')
    def test_gold_only_target_formats(self):
        a=module.target_ranges({'target_time':{'date':'Day1','time':'11152408'}})
        self.assertEqual(a[0][0],module.clock('DAY1','11152408')['cutoffMs'])
        b=module.target_ranges({'target_time':{'date':'DAY1','time':'23595900DAY2_00000100'}})
        self.assertEqual(b,[(86399000,86401000)])
    def test_clip_end_is_not_visible_frame(self):
        self.assertTrue(module.covers([(0,1000),(1000,2000)],500,1500))
        self.assertFalse(module.covers([(0,1000)],1000,1000))
        self.assertFalse(module.covers([(0,1000),(2000,3000)],500,2500))
    def test_public_fields_exclude_labels(self):
        row={'ID':'1','type':'EntityLog','question':'Where?','query_time':{'date':'DAY1','time':'11210217'},'choice_a':'desk','choice_b':'shelf','choice_c':'drawer','choice_d':'unknown','answer':'A','target_time':{'date':'DAY1','time':'11152408'},'reason':'secret'}
        public=module.public_task(row)
        self.assertEqual(set(public),{'ID','type','question','choices','queryTime','untilTime','cutoffMs'})

if __name__=='__main__':unittest.main()

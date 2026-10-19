import unittest
from sim.capture.audit_mansionworld_access import classify
from sim.spatial.spatial_runtime_preflight import diagnose


class PreparationTests(unittest.TestCase):
    def test_public_cc_label_does_not_silence_research_only_conflict(self):
        result=classify({'license':'cc-by-4.0','extra_gated_prompt':'For research purposes only'},'License: CC BY 4.0')
        self.assertEqual(result['status'],'clarification-required');self.assertFalse(result['datasetUseApproved'])
        self.assertFalse(classify({'license':'cc-by-4.0'},'CC BY 4.0')['datasetUseApproved'])

    def test_diagnostics_are_structured_without_secrets(self):
        result=diagnose();self.assertIn('devices',result);self.assertNotIn('QWEN_API_KEY',str(result))


if __name__=='__main__':unittest.main()

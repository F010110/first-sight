import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
from download_activity_sources import get_tree

class MetadataRecoveryTests(unittest.TestCase):
    def test_transport_retry_then_offline_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'tree.json'
            with patch('download_activity_sources.get',side_effect=[urllib.error.URLError('TLS EOF'),b'[]']) as get,patch('download_activity_sources.time.sleep'):
                self.assertEqual(get_tree('https://example.invalid/pinned',path),[])
                self.assertEqual(get.call_count,2)
            with patch('download_activity_sources.get',side_effect=AssertionError('must use cache')):
                self.assertEqual(get_tree('https://example.invalid/pinned',path),[])

    def test_bad_json_and_auth_failure_are_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            for failure in [json.JSONDecodeError('bad','',0),urllib.error.HTTPError('https://example.invalid',403,'Forbidden',{},None)]:
                with patch('download_activity_sources.get',side_effect=failure) as get:
                    with self.assertRaises(type(failure)):get_tree('https://example.invalid',Path(tmp)/'tree.json')
                    self.assertEqual(get.call_count,1)

if __name__=='__main__':unittest.main()

import json
import unittest
from types import SimpleNamespace
from sim.grouping.vlm_boundary_group_trial import request_with_protocol_retries


def response(answer):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)))])


class RetryTests(unittest.TestCase):
    def test_missing_citation_repaired_and_first_valid_stops(self):
        base = {'regions': [{'groupIds': ['G01', 'G02'], 'reason': 'instance', 'evidence': ['G01:a']}], 'boundaryGroups': [], 'boundaryObservations': [], 'uncertainGroupIds': [], 'uncertaintyReasons': {}}
        fixed = json.loads(json.dumps(base)); fixed['regions'][0]['evidence'].append('G02:b')
        replies = iter([response(base), response(fixed)])
        calls = []; saved = []
        def request(messages):
            calls.append(list(messages)); return next(replies)
        _, _, history = request_with_protocol_retries(request, [{'type': 'text', 'text': 'original evidence'}], {'G01', 'G02'}, {'G01:a', 'G02:b'}, 2, lambda *args: saved.append(args))
        self.assertEqual(len(calls), 2); self.assertEqual(len(saved), 2)
        self.assertIn('校验失败', calls[1][-1]['content'])
        self.assertFalse(history[0]['valid']); self.assertTrue(history[1]['valid'])

    def test_invalid_json_exhaustion_is_bounded(self):
        calls = []
        def request(messages):
            calls.append(1); return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='invalid'))])
        _, _, history = request_with_protocol_retries(request, [], set(), set(), 2, lambda *args: None)
        self.assertEqual(len(calls), 3)
        self.assertFalse(history[-1]['valid'])


if __name__ == '__main__':
    unittest.main()

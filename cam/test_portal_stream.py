import hashlib
import io
import unittest
from PIL import Image
from portal_stream import validate_frame


class PortalStreamTest(unittest.TestCase):
    def test_wire_integrity_reset_sequence_and_size(self):
        buffer = io.BytesIO()
        Image.new('RGB', (640, 480)).save(buffer, format='JPEG')
        data = buffer.getvalue()
        headers = {'Content-Length':str(len(data)), 'X-Frame-Sha256': hashlib.sha256(data).hexdigest(), 'X-Boot-Id': 'boot', 'X-Sequence': '0', 'X-Capture-Ms': '100'}
        self.assertEqual(validate_frame(data, headers, None, -1), ('boot', 0, 100))
        for bad in [{'Content-Length':str(len(data)+1)}, {'X-Frame-Sha256': 'bad'}, {'X-Boot-Id': ''}, {'X-Sequence': '2'}, {'X-Capture-Ms': '-1'}]:
            with self.assertRaises(ValueError):
                validate_frame(data, dict(headers, **bad), None, -1)
        with self.assertRaises(ValueError):
            validate_frame(data, headers, 'other-boot', -1)
        with self.assertRaises(ValueError):
            validate_frame(data[:-5], headers, None, -1)


if __name__ == '__main__':
    unittest.main()

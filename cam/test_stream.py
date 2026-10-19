import io
import unittest
from PIL import Image
from stream import read_frame


class Port(io.BytesIO):
    pass


class ProtocolTests(unittest.TestCase):
    def fixture(self):
        image=Image.new('RGB',(16,16));data=io.BytesIO();image.save(data,format='JPEG')
        return data.getvalue()

    def test_complete_frame_with_startup_noise(self):
        data=self.fixture()
        port=Port(b'READY\nFRAME '+str(len(data)).encode()+b' 16 16\n'+data+b'\nEND_FRAME\r\n')
        self.assertEqual(read_frame(port),(data,16,16))

    def test_reject_bad_dimensions_terminator_and_jpeg(self):
        data=self.fixture()
        for header,body,end in [(b'0 16 16',data,b'END_FRAME'),(str(len(data)).encode()+b' 32 32',data,b'END_FRAME'),(str(len(data)).encode()+b' 16 16',data,b'BAD'),(b'3 16 16',b'bad',b'END_FRAME')]:
            with self.assertRaises(ValueError):
                read_frame(Port(b'FRAME '+header+b'\n'+body+b'\n'+end+b'\r\n'),timeout=.1)

    def test_device_capture_failure(self):
        with self.assertRaises(RuntimeError):read_frame(Port(b'CAPTURE_FAILED\n'))


if __name__=='__main__':unittest.main()

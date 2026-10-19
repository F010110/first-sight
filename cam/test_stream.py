import io
import unittest
from PIL import Image
from stream import read_frame, switch_baud


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

    def test_baud_requires_old_and_new_rate_acknowledgements(self):
        class Serial:
            baudrate=115200
            def __init__(self):self.lines=iter([b'noise\n',b'BAUD_SWITCH 460800\n',b'BAUD_READY 460800\n']);self.writes=[]
            def write(self,data):self.writes.append(data)
            def flush(self):pass
            def readline(self):return next(self.lines)
        port=Serial();switch_baud(port,460800)
        self.assertEqual(port.baudrate,460800)
        self.assertEqual(port.writes,[b'b460800\n'])
        # Switching to the current rate is a no-op (old firmware still works).
        switch_baud(port,460800);self.assertEqual(len(port.writes),1)

    def test_missing_baud_ack_is_not_success(self):
        from unittest.mock import patch
        class Serial:
            baudrate=115200
            def write(self,data):pass
            def flush(self):pass
            def readline(self):return b'BAUD_REJECTED\n'
        with patch('stream.time.monotonic',side_effect=[0,1,4]):
            with self.assertRaises(TimeoutError):switch_baud(Serial(),460800)

    def test_missing_new_rate_confirmation_is_not_success(self):
        from unittest.mock import patch
        class Serial:
            baudrate=115200
            def __init__(self):self.lines=iter([b'BAUD_SWITCH 230400\n',b'garbled\n'])
            def write(self,data):pass
            def flush(self):pass
            def readline(self):return next(self.lines)
        port=Serial()
        with patch('stream.time.monotonic',side_effect=[0,1,1,4]):
            with self.assertRaises(TimeoutError):switch_baud(port,230400)
        self.assertEqual(port.baudrate,230400)


if __name__=='__main__':unittest.main()

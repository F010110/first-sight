import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import configure_hotspot

class FakeSerial:
    def __init__(self,lines):self.lines=list(lines);self.writes=[]
    def __enter__(self):return self
    def __exit__(self,*_):pass
    def readline(self):return (self.lines.pop(0)+'\n').encode()
    def write(self,value):self.writes.append(value)
    def flush(self):pass

class HotspotTest(unittest.TestCase):
    def test_private_profile_hex_transport_and_no_secret_output(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'profile.json';path.write_text(json.dumps(dict(ssid='test-network',password='test-passphrase')))
            device=FakeSerial(['NETWORK_PAIRED','HOTSPOT_SECRETS_READY','HOTSPOT_CONFIGURED']);output=io.StringIO()
            with patch('sys.argv',['configure_hotspot','--config',str(path)]),patch.object(configure_hotspot.serial,'Serial',return_value=device),patch.object(configure_hotspot.time,'sleep'),contextlib.redirect_stdout(output):configure_hotspot.main()
            self.assertEqual(device.writes[0],b'WIFI_HOTSPOT\n')
            self.assertEqual(device.writes[1],b'test-network'.hex().encode()+b'\n'+b'test-passphrase'.hex().encode()+b'\n')
            self.assertNotIn('test-passphrase',output.getvalue());self.assertNotIn('test-network',output.getvalue())
    def test_restore_private_computer_address(self):
        device=FakeSerial(['NETWORK_PAIRED','UPLINK_CONFIGURED','CAMPUS_PROFILE_CONFIGURED'])
        with patch('sys.argv',['configure_hotspot','--restore-campus-host','10.21.167.88']),patch.object(configure_hotspot.serial,'Serial',return_value=device),patch.object(configure_hotspot.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):configure_hotspot.main()
        self.assertEqual(device.writes,[b'UPLINK http://10.21.167.88:8885/v1/upload\n',b'WIFI_CAMPUS\n'])

if __name__=='__main__':unittest.main()

import hashlib
import io
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from PIL import Image
from wifi_receiver import Rig,handler


class WifiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.rig=Rig(Path(self.tmp.name)/'capture',dict(front='f',left='l',right='r'),count=1)
        self.rig.start=time.monotonic()-.01
        buffer=io.BytesIO();Image.new('RGB',(640,480)).save(buffer,format='JPEG');self.image=buffer.getvalue();self.sha=hashlib.sha256(self.image).hexdigest()
    def tearDown(self):self.tmp.cleanup()
    def upload(self,device,index=0):
        self.rig.next(device,'boot');self.rig.frame(device,'boot',index,0,self.image,self.sha,10)
    def test_three_actual_uploads_one_ordered_receipt(self):
        import json
        for device in ('r','f','l'):self.upload(device)
        self.rig.close_round(0)
        row=json.loads((self.rig.root/'observations.jsonl').read_text())
        self.assertEqual([c['direction'] for c in row['cameras']],['front','left','right'])
        self.assertEqual(len(set(row['frames'])),3);self.assertFalse(row['exposureTimeKnown'])
    def test_missing_view_is_not_filled_from_other_cameras(self):
        self.upload('f');self.upload('l');self.rig.close_round(0)
        self.assertEqual(self.rig.published,0);self.assertEqual(self.rig.missing,1)
        self.assertEqual(len(list((self.rig.root/'frames').iterdir())),2)
    def test_reboot_duplicate_digest_and_expired_round_rejected(self):
        self.upload('f')
        with self.assertRaises(ValueError):self.rig.next('f','reboot')
        with self.assertRaises(ValueError):self.rig.frame('f','boot',0,1,self.image,self.sha,10)
        self.rig.next('l','boot')
        with self.assertRaises(ValueError):self.rig.frame('l','boot',0,0,self.image,'bad',10)
        self.rig.close_round(0)
        with self.assertRaises(ValueError):self.rig.frame('l','boot',0,0,self.image,self.sha,10)
    def test_dispatch_skew_blocks_grouping_despite_close_arrival(self):
        for device in ('f','l','r'):self.upload(device)
        self.rig.rounds[0]['dispatch']['f']-=.5
        self.rig.close_round(0);self.assertEqual(self.rig.published,0)
    def test_http_requires_authentication_and_rejects_oversize(self):
        token='x'*32;server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.rig,token))
        thread=threading.Thread(target=server.serve_forever);thread.start()
        try:
            url=f'http://127.0.0.1:{server.server_port}'
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(url+'/v1/next/f/boot')
            self.assertEqual(error.exception.code,401)
            error.exception.close()
            with urllib.request.urlopen(urllib.request.Request(url+'/v1/next/f/boot',headers={'Authorization':'Bearer '+token})) as response:self.assertIn(b'CAPTURE',response.read())
            request=urllib.request.Request(url+'/v1/frame',data=b'x',headers={'Authorization':'Bearer '+token,'Content-Type':'image/jpeg','Content-Length':'300001'})
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(request)
            self.assertEqual(error.exception.code,409)
            error.exception.close()
        finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()

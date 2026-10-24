import base64
import hashlib
import http.client
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import threading
import queue
from PIL import Image

class PushTest(unittest.TestCase):
    def test_preview_no_disk_then_record_and_reject_invalid_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/'config.json';config.write_text(json.dumps(dict(token='a'*64)))
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('push_stream.py')),str(root/'capture'),'--host','127.0.0.1','--port',str(port),'--config',str(config)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            previews=queue.Queue()
            def consume():
                for line in process.stdout:previews.put(json.loads(line))
            reader=threading.Thread(target=consume,daemon=True);reader.start()
            try:
                deadline=time.monotonic()+10
                while not (root/'capture/receiver-status.json').exists() and time.monotonic()<deadline:time.sleep(.1)
                buf=io.BytesIO();Image.new('RGB',(640,480)).save(buf,'JPEG');data=buf.getvalue()
                headers={'Authorization':'Bearer '+'a'*64,'Content-Type':'image/jpeg','X-Frame-Sha256':hashlib.sha256(data).hexdigest(),'X-Boot-Id':'boot','X-Sequence':'0','X-Capture-Ms':'1','X-Jpeg-Quality':'16'}
                def post(h):
                    client=http.client.HTTPConnection('127.0.0.1',port,timeout=5);client.request('POST','/v1/upload',data,h);response=client.getresponse();status=response.status;response.read();client.close();return status
                self.assertEqual(post(headers),200);preview=previews.get(timeout=5);self.assertEqual(base64.b64decode(preview['jpeg']),data);self.assertEqual(list((root/'capture/frames').glob('*')),[])
                process.stdin.write('{"record":true}\n');process.stdin.flush();time.sleep(.2);headers['X-Sequence']='1';self.assertEqual(post(headers),200);previews.get(timeout=5)
                self.assertEqual(len(list((root/'capture/frames').glob('*.jpg'))),1)
                self.assertEqual(post(headers),400)
                headers['Authorization']='wrong';self.assertEqual(post(headers),401)
            finally:
                process.terminate();process.wait(timeout=5);reader.join(timeout=5);process.stdin.close();process.stdout.close();process.stderr.close()

if __name__=='__main__':unittest.main()

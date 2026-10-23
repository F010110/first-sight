import hashlib
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from PIL import Image


class NetworkReceiverTest(unittest.TestCase):
    def test_truncation_then_recovery_and_new_boot_preserve_gap_and_originals(self):
        stream=io.BytesIO()
        Image.new('RGB',(640,480),(20,40,60)).save(stream,'JPEG')
        jpeg=stream.getvalue()
        class Handler(BaseHTTPRequestHandler):
            count=0
            def log_message(self,*_): pass
            def do_GET(self):
                if self.path=='/v1/status':
                    body=json.dumps(dict(device='first-sight-cam',bootId='boot-a',authAttempted=True)).encode()
                    self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
                Handler.count+=1
                self.send_response(200)
                self.send_header('Content-Length',str(len(jpeg)))
                self.send_header('Content-Type','image/jpeg')
                self.send_header('X-Frame-Sha256',hashlib.sha256(jpeg).hexdigest())
                self.send_header('X-Boot-Id','boot-b' if Handler.count>=3 else 'boot-a')
                self.send_header('X-Sequence',str(0 if Handler.count>=3 else 5))
                self.send_header('X-Capture-Ms','10');self.send_header('X-Jpeg-Quality','16');self.end_headers()
                self.wfile.write(jpeg[:500] if Handler.count==1 else jpeg)
                self.close_connection=True
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);config=root/'camera.json'
                config.write_text(json.dumps(dict(host=f'127.0.0.1:{server.server_port}',token='a'*64)))
                process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('network_stream.py')),str(root/'capture'),'--config',str(config),'--interval','1'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                try:
                    deadline=time.monotonic()+20;rows=[]
                    while time.monotonic()<deadline:
                        path=root/'capture/observations.jsonl'
                        if path.exists():
                            text=path.read_text();rows=[json.loads(l) for l in text[:text.rfind('\n')+1].splitlines()]
                        if len(rows)>=2:break
                        if process.poll() is not None:self.fail('Receiver exited: '+process.stderr.read().decode())
                        time.sleep(.1)
                    self.assertGreaterEqual(len(rows),2)
                    self.assertEqual([r['sequence'] for r in rows[:2]],[0,1])
                    self.assertEqual([r['deviceSequence'] for r in rows[:2]],[5,0])
                    self.assertTrue(all(r['gapBefore'] for r in rows[:2]))
                    self.assertEqual(Path(rows[0]['frames'][0]).read_bytes(),jpeg)
                    self.assertEqual((root/'capture/failed-responses/000000000.bin').read_bytes(),jpeg[:500])
                finally:
                    process.terminate();process.wait(timeout=5);process.stderr.close()
                Handler.count=1
                preview=root/'preview'
                process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('network_stream.py')),str(preview),'--config',str(config),'--interval','1','--preview'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                try:
                    frame=json.loads(process.stdout.readline())
                    self.assertEqual(frame['kind'],'preview')
                    self.assertFalse(list((preview/'frames').glob('*.jpg')))
                    self.assertEqual((preview/'observations.jsonl').read_text(),'')
                    process.stdin.write('{"record":true}\n');process.stdin.flush()
                    deadline=time.monotonic()+10
                    while time.monotonic()<deadline and not list((preview/'frames').glob('*.jpg')):time.sleep(.1)
                    self.assertTrue(list((preview/'frames').glob('*.jpg')))
                finally:
                    process.terminate();process.wait(timeout=5)
                    process.stdin.close();process.stdout.close();process.stderr.close()
        finally:
            server.shutdown();server.server_close();worker.join()

if __name__=='__main__':unittest.main()

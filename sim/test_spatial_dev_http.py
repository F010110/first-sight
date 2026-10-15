import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request


class DeveloperHttpTests(unittest.TestCase):
    def test_local_panel_replay_restart_no_billing_and_gt_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);dataset=root/'dataset';dataset.mkdir();workspace=root/'memory'
            (dataset/'dataset-report.json').write_text('{"buildings":1}')
            (dataset/'frame.png').write_bytes(bytes.fromhex('89504e470d0a1a0a'))
            (dataset/'observations.jsonl').write_text(json.dumps({'id':'s:0','sessionId':'s','atMs':0,'cameras':dict.fromkeys(['front','left','right'],'frame.png')})+'\n')
            (dataset/'evaluation-only').mkdir();(dataset/'evaluation-only/truth.json').write_text('{"secretPose":123}')
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            base=f'http://127.0.0.1:{port}';opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            env={**os.environ};env.pop('QWEN_API_KEY',None);env.pop('QWEN_BASE_URL',None)
            def launch():
                process=subprocess.Popen(['node','dist/sim/spatial-dev-server.js',str(dataset),str(workspace),str(port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                for _ in range(40):
                    if process.poll() is not None:raise AssertionError('Developer server exited')
                    try:
                        with opener.open(base,timeout=1) as response:page=response.read().decode()
                        return process,re.search("const token='([a-f0-9]+)'",page)[1],page
                    except (OSError,urllib.error.URLError):time.sleep(.1)
                process.terminate();process.wait(timeout=10);raise AssertionError('Server readiness timeout')
            process,token,page=launch()
            def command(action,**values):
                request=urllib.request.Request(base+'/command',data=json.dumps({'action':action,**values}).encode(),headers={'Content-Type':'application/json','X-Dev-Token':token},method='POST')
                with opener.open(request,timeout=2) as response:return json.load(response)
            try:
                self.assertIn('空间记忆开发台',page);self.assertNotIn('secretPose',page)
                self.assertEqual(command('status')['status']['pending'],0)
                command('step');self.assertEqual(command('status')['status']['pending'],1)
                with self.assertRaises(urllib.error.HTTPError) as error:command('recognize')
                self.assertIn('paid-call',error.exception.read().decode())
                error.exception.close()
                self.assertEqual(command('retrieve',id='s:0')['status'],'unknown')
                with self.assertRaises(urllib.error.HTTPError) as error:opener.open(base+'/evaluation-only/truth.json')
                error.exception.close()
                with self.assertRaises(urllib.error.HTTPError) as error:opener.open(base+'/image?id=..%2Fframe.png&camera=0')
                error.exception.close()
                process.terminate();process.wait(timeout=10)
                process,token,_=launch();self.assertEqual(command('status')['status']['pending'],1)
            finally:
                if process.poll() is None:process.terminate();process.wait(timeout=10)


if __name__=='__main__':unittest.main()

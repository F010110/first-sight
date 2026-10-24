"""Local authenticated HTTP smoke test, isolated data, no model calls."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
import urllib.error


class SpatialHttpTest(unittest.TestCase):
    def test_recovery_across_login_without_model(self):
        with tempfile.TemporaryDirectory() as directory:
            # Match the server's wildcard bind. A loopback-only reservation can
            # select a port still occupied on another local address on Windows.
            with socket.socket() as sock:
                if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):
                    sock.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
                sock.bind(('0.0.0.0',0));port=sock.getsockname()[1]
            env={**os.environ,'VLM_TRIAL_PORT':str(port),'VLM_TRIAL_PASSCODE':'spatial-test-only','VLM_EXPERIMENT_ROOT':directory}
            env.pop('QWEN_API_KEY',None);env.pop('QWEN_BASE_URL',None)
            process=subprocess.Popen(['node','dist/current/trial-server.js'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            try:
                # Trial server may enable local TLS if a workspace certificate exists.
                import ssl
                scheme='https' if Path('run/tls/vlm-server.pfx').exists() else 'http'
                context=ssl._create_unverified_context() if scheme=='https' else None
                base=f'{scheme}://127.0.0.1:{port}'
                opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context))
                def request(path,payload,token=None):
                    headers={'Content-Type':'application/json','Origin':base}
                    if token:headers['Authorization']='Bearer '+token
                    req=urllib.request.Request(base+path,data=json.dumps(payload).encode(),headers=headers)
                    with opener.open(req,timeout=2) as response:return response.status,json.load(response)
                token=None
                for _ in range(15):
                    if process.poll() is not None:self.fail('Trial server exited during startup: '+process.stderr.read().decode(errors='replace'))
                    try:_,login=request('/api/login',{'passcode':'spatial-test-only'});token=login['token'];break
                    except (OSError,urllib.error.URLError):time.sleep(.1)
                self.assertIsNotNone(token)
                status,credentials=request('/api/spatial',{'action':'create-library'},token);self.assertEqual(status,201)
                image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
                status,_=request('/api/spatial',{'action':'observe','id':'r:1','recordingId':'r','sourceAtMs':0,'frames':[{'mimeType':'image/png','dataBase64':image}]},token);self.assertEqual(status,202)
                _,login=request('/api/login',{'passcode':'spatial-test-only'});second=login['token']
                with self.assertRaises(urllib.error.HTTPError) as error:request('/api/spatial',{'action':'open-library','libraryId':credentials['libraryId'],'recoveryKey':'x'*43},second)
                self.assertEqual(error.exception.code,400)
                error.exception.close()
                request('/api/spatial',{'action':'open-library','libraryId':credentials['libraryId'],'recoveryKey':credentials['recoveryKey']},second)
                _,snapshot=request('/api/spatial',{'action':'snapshot'},second)
                self.assertEqual(snapshot['status']['pending'],1);self.assertFalse(snapshot['status']['running']);self.assertEqual(len(snapshot['graph']['observations']),1)
                with self.assertRaises(urllib.error.HTTPError) as error:request('/api/spatial',{'action':'start'},second)
                self.assertEqual(error.exception.code,503)
                error.exception.close()
                process.terminate();process.wait(timeout=10);process.stderr.close()
                process=subprocess.Popen(['node','dist/current/trial-server.js'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                restarted=None
                for _ in range(15):
                    if process.poll() is not None:self.fail('Trial server exited during restart: '+process.stderr.read().decode(errors='replace'))
                    try:_,login=request('/api/login',{'passcode':'spatial-test-only'});restarted=login['token'];break
                    except (OSError,urllib.error.URLError):time.sleep(.1)
                self.assertIsNotNone(restarted)
                request('/api/spatial',{'action':'open-library','libraryId':credentials['libraryId'],'recoveryKey':credentials['recoveryKey']},restarted)
                _,snapshot=request('/api/spatial',{'action':'snapshot','limit':1,'cursor':0},restarted)
                self.assertEqual(snapshot['status']['pending'],1);self.assertFalse(snapshot['status']['running'])
                self.assertEqual(snapshot['graph']['observations'][0]['id'],'r:1')
                self.assertGreater(snapshot['graph']['nextCursor'],0)
            finally:
                process.terminate();process.wait(timeout=10);process.stderr.close()


if __name__=='__main__':unittest.main()

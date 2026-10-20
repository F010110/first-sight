"""Local synthetic three-sender -> receiver -> real input-adapter acceptance. No VLM."""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);args=parser.parse_args()
    root=args.output.resolve();root.mkdir(parents=True,exist_ok=False)
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    env={**os.environ,'FIRST_SIGHT_CAMERA_TOKEN':secrets.token_urlsafe(32)}
    capture=root/'synthetic-capture';consumer=root/'validated-input'
    with (root/'receiver.log').open('w',encoding='utf8') as log:
        server=subprocess.Popen([sys.executable,'cam/wifi_receiver.py',str(capture),'--port',str(port),'--count','3'],env=env,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+10
            while not (capture/'plan.json').exists():
                if server.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Receiver startup failed')
                time.sleep(.05)
            subprocess.run([sys.executable,'cam/mock_wifi.py','--server',f'http://127.0.0.1:{port}','--seconds','12'],env=env,check=True,timeout=20)
            if server.wait(timeout=15)!=0:raise RuntimeError('Receiver failed')
            complete=json.loads((capture/'complete.json').read_text())
            if complete['frames']!=3 or complete['missingRounds']!=0:raise RuntimeError(complete)
            subprocess.run(['node','dist/current/hardware/run-camera.js',str(capture),str(consumer),'--validate-only'],check=True,timeout=20)
            (root/'report.json').write_text(json.dumps(dict(status='local-protocol-validated',syntheticInputs=True,
                actualWiFiTested=False,firmwareFlashed=False,modelCalls=0,capture=complete,
                adapter=json.loads((consumer/'complete.json').read_text())),indent=2),encoding='utf8')
            print((root/'report.json').read_text())
        finally:
            if server.poll() is None:server.terminate();server.wait(timeout=5)


if __name__=='__main__':main()

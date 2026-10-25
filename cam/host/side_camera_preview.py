"""Identity-checked left/right previews; JPEG bytes stay in RAM, no serial or models."""
import base64
import concurrent.futures
import hashlib
import http.client
import io
import json
from pathlib import Path
import socket
import threading
import time
from PIL import Image

lock = threading.Lock()
def emit(row):
    with lock:
        print(json.dumps(row), flush=True)

def receive(role):
    config_path = Path(__file__).resolve().parent.parent/'local'/f'network-camera-{role}.json'
    previous_boot, previous_seq = None, -1
    while True:
        connection = None
        try:
            config = json.loads(config_path.read_text(encoding='utf-8-sig'))
            if config['direction'] != role or not config['cameraId'].startswith('first-sight-'):
                raise ValueError('Invalid role configuration')
            # Try the commissioned address, then the unique device hostname.
            hosts = [config['host'], config['cameraId']+'.local']
            for host in hosts:
                try:
                    ip = socket.gethostbyname(host)
                    import ipaddress
                    if not ipaddress.ip_address(ip).is_private:
                        raise ValueError('Camera must use a private address')
                    connection = http.client.HTTPConnection(ip, timeout=8)
                    connection.request('GET', '/v1/status', headers={'Authorization':'Bearer '+config['token']})
                    response = connection.getresponse()
                    if response.status != 200:
                        raise ValueError('Pairing rejected')
                    status = json.loads(response.read(8192))
                    if status.get('cameraId') != config['cameraId'] or status.get('direction') != role:
                        raise ValueError('Identity mismatch')
                    connection.close()
                    break
                except OSError:
                    if connection: connection.close()
            else:
                raise ConnectionError('Camera unavailable')
            connection = http.client.HTTPConnection(ip, timeout=15)
            started = time.time_ns()//1000000
            connection.request('GET', '/v1/frame', headers={'Authorization':'Bearer '+config['token']})
            response = connection.getresponse()
            data = response.read(300001)
            if response.status != 200 or not 0 < len(data) <= 300000:
                raise ValueError('Invalid frame')
            if response.getheader('X-Camera-Id') != config['cameraId'] or response.getheader('X-Camera-Direction') != role:
                raise ValueError('Frame identity mismatch')
            digest = hashlib.sha256(data).hexdigest()
            if digest != response.getheader('X-Frame-Sha256'):
                raise ValueError('Frame hash mismatch')
            boot = response.getheader('X-Boot-Id')
            sequence = int(response.getheader('X-Sequence', '-1'))
            if not boot or boot != status.get('bootId') or sequence < 0 or (boot == previous_boot and sequence <= previous_seq):
                raise ValueError('Invalid frame session/sequence')
            image = Image.open(io.BytesIO(data)); image.load()
            if image.size != (640,480):
                raise ValueError('Unexpected image dimensions')
            previous_boot, previous_seq = boot, sequence
            emit(dict(kind='preview',direction=role,cameraId=config['cameraId'],id=f'{role}:{boot}:{sequence}',atMs=started,sha256=digest,jpeg=base64.b64encode(data).decode('ascii')))
        except Exception as error:
            emit(dict(kind='health',direction=role,error=type(error).__name__))
        finally:
            if connection: connection.close()
        time.sleep(2)

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(receive, ['left','right']))

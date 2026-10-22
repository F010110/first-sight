"""Continuous LAN-only camera receiver. No serial access, firmware upload or USB reset."""
import argparse
import hashlib
import http.client
import json
import ipaddress
from pathlib import Path
import signal
import socket
import time
import uuid
from urllib.parse import urlsplit
from portal_stream import validate_frame

running = True
def urllib_host(host):
    value = urlsplit('http://'+host)
    if value.username or value.password or value.path or not value.hostname:
        raise ValueError('Invalid local camera host')
    address = socket.gethostbyname(value.hostname)
    if not ipaddress.ip_address(address).is_private:
        raise ValueError('Camera address must be private')
    return address, value.port or 80
def stop(*_):
    global running
    running = False

def atomic(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf8')
    temporary.replace(path)

def discover():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(1)
        sock.sendto(b'FIRST_SIGHT_DISCOVER_1', ('255.255.255.255', 33333))
        data, address = sock.recvfrom(128)
        if data != b'FIRST_SIGHT_CAMERA_1':
            raise ValueError('Unknown discovery response')
        return address[0]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--config', type=Path, default=Path(__file__).parent/'local/network-camera.json')
    parser.add_argument('--interval', type=float, default=2)
    args = parser.parse_args()
    if not 1 <= args.interval <= 10:
        parser.error('interval must be 1..10 seconds')
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root/'frames').mkdir()
    (root/'failed-responses').mkdir()
    (root/'observations.jsonl').touch()
    recording = str(uuid.uuid4())
    atomic(root/'plan.json', dict(schemaVersion=1, recordingId=recording, transport='wifi-network-http',
                                timestampSource='host-request', exposureTimeKnown=False, requestedFrames=None,
                                requestedIntervalSeconds=args.interval, usbRequired=False))
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    index, attempt, previous_boot, previous_sequence = 0, 0, None, -1
    broken, failures, host = True, 0, None
    start = time.monotonic()
    try:
        while running:
            requested = time.monotonic()
            wall = time.time_ns()//1000000
            data, metadata, client = b'', {}, None
            try:
                config = json.loads(args.config.read_text(encoding='utf-8-sig'))
                token = config['token']
                if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
                    raise ValueError('Invalid local pairing key')
                if not host:
                    host = config.get('host', 'first-sight-cam.local')
                if failures and failures % 3 == 0:
                    try:
                        host = socket.gethostbyname('first-sight-cam.local') if failures % 6 else discover()
                    except (OSError, ValueError):
                        host = config.get('host', 'first-sight-cam.local')
                parsed = urllib_host(host)
                client = http.client.HTTPConnection(parsed[0], parsed[1], timeout=8)
                # HTTPConnection deliberately ignores proxy environment variables.
                if previous_boot is None or failures:
                    client.request('GET', '/v1/status', headers={'Authorization':'Bearer '+token})
                    status_response = client.getresponse()
                    if status_response.status != 200:
                        raise ValueError('Camera pairing rejected')
                    status = json.loads(status_response.read(8192))
                    if status.get('device') != 'first-sight-cam':
                        raise ValueError('Unknown camera identity')
                    boot = status['bootId']
                    client.close()
                    client = http.client.HTTPConnection(parsed[0], parsed[1], timeout=8)
                requested = time.monotonic()
                wall = time.time_ns()//1000000
                client.request('GET', '/v1/frame', headers={'Authorization':'Bearer '+token,'Connection':'close'})
                response = client.getresponse()
                metadata = {k:response.headers.get(k) for k in ['Content-Length','Content-Type','X-Frame-Sha256','X-Boot-Id','X-Sequence','X-Capture-Ms','X-Jpeg-Quality']}
                length = int(response.headers.get('Content-Length', '-1'))
                if response.status != 200 or not 0 < length <= 300000:
                    raise ValueError('Invalid camera response')
                # Preserve partial bytes even when the socket times out mid-body.
                while len(data) < length:
                    part = response.read1(min(16384, length-len(data)))
                    if not part:
                        break
                    data += part
                seq = int(response.headers.get('X-Sequence', '-1'))
                if seq < 0:
                    raise ValueError('Invalid device sequence')
                boot, seq, captured = validate_frame(data, response.headers, None, seq-1, 16)
                if previous_boot == boot and seq <= previous_sequence:
                    raise ValueError('Repeated or regressed device frame')
                gap = broken or boot != previous_boot or seq != previous_sequence+1
                received = time.monotonic()
                at = round((requested-start)*1000)
                path = root/'frames'/f'{index:09d}.jpg'
                path.write_bytes(data)
                digest = hashlib.sha256(data).hexdigest()
                row = dict(id=f'{recording}:{index}',recordingId=recording,sequence=index,atMs=at,sourceAtMs=at,
                           frames=[str(path)],sha256=digest,wireSha256=digest,bytes=len(data),direction='front',
                           transport='wifi-network-http',timestampSource='host-request',exposureTimeKnown=False,
                           receivedAtMs=round((received-start)*1000),requestWallTimeMs=wall,
                           deviceBootId=boot,deviceSequence=seq,deviceCaptureMs=captured,deviceClockAligned=False,
                           width=640,height=480,jpegQuality=16,gapBefore=gap,requestToReceiveMs=round((received-requested)*1000))
                with (root/'observations.jsonl').open('a',encoding='utf8') as output:
                    output.write(json.dumps(row)+'\n')
                previous_boot, previous_sequence = boot, seq
                index += 1
                broken, failures = False, 0
                atomic(root/'receiver-status.json', dict(state='receiving',frames=index,attempts=attempt+1,lastReceivedWallMs=time.time_ns()//1000000,usbRequired=False))
            except Exception as error:
                broken, failures = True, failures+1
                (root/'failed-responses'/f'{attempt:09d}.bin').write_bytes(data)
                metadata.update(errorType=type(error).__name__,receivedBytes=len(data),receivedSha256=hashlib.sha256(data).hexdigest())
                atomic(root/'failed-responses'/f'{attempt:09d}.json',metadata)
                atomic(root/'receiver-status.json',dict(state='waiting-for-camera',frames=index,attempts=attempt+1,
                                                       consecutiveFailures=failures,errorType=type(error).__name__,usbRequired=False))
            finally:
                if client:
                    client.close()
                attempt += 1
            due = requested + (min(10, 2+failures) if failures else args.interval)
            while running and time.monotonic() < due:
                time.sleep(.1)
    finally:
        atomic(root/'stopped.json',dict(status='receiver-stopped',frames=index,attempts=attempt))

if __name__ == '__main__':
    main()

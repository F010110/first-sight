"""Bounded single-camera Wi-Fi pull. USB carries setup secrets only, never images."""
import argparse
import hashlib
import io
import ipaddress
import json
from pathlib import Path
import secrets
import statistics
import time
import urllib.request
import uuid
import serial
from PIL import Image


def validate_frame(data, headers, previous_boot, previous_sequence):
    if not 0 < len(data) <= 300000 or hashlib.sha256(data).hexdigest() != headers.get('X-Frame-Sha256'):
        raise ValueError('Wi-Fi image wire checksum/size failure')
    boot = headers.get('X-Boot-Id', '')
    sequence = int(headers.get('X-Sequence', '-1'))
    if not boot or previous_boot is not None and boot != previous_boot or sequence != previous_sequence+1:
        raise ValueError('Device reset or non-contiguous device sequence; start a new recording')
    captured = int(headers.get('X-Capture-Ms', '-1'))
    if captured < 0:
        raise ValueError('Missing raw device timestamp')
    with Image.open(io.BytesIO(data)) as image:
        if image.format != 'JPEG' or image.size != (640, 480):
            raise ValueError('Require original VGA JPEG')
        image.load()
    return boot, sequence, captured


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--port', default='COM3')
    p.add_argument('--count', type=int, default=30)
    p.add_argument('--interval', type=float, default=2)
    p.add_argument('--confirm-http-credentials', action='store_true', required=True)
    args = p.parse_args()
    if not 1 <= args.count <= 60 or not 1 <= args.interval <= 10 or args.count*args.interval > 140:
        p.error('Bounded capture requires count 1..60, interval 1..10, total <=140s')
    c = json.loads((Path(__file__).parent/'local/campus-credentials.json').read_text(encoding='utf-8-sig'))
    values = [c.get('username'), c.get('password')]
    if any(not isinstance(v, str) or not v or len(v.encode('utf8')) > 1024 for v in values):
        raise ValueError('Invalid local credentials')
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root/'frames').mkdir()
    (root/'observations.jsonl').touch()
    recording = str(uuid.uuid4())
    plan = dict(schemaVersion=1, recordingId=recording, cameraId='esp32-s3-front-1',
                requestedIntervalSeconds=args.interval, requestedFrames=args.count,
                transport='wifi-single-http', timestampSource='host-request',
                exposureTimeKnown=False, sideCamerasAvailable=False,
                limits='HTTP plaintext; bearer authorization and SHA256 are not encryption. Device clock not host-aligned. No automatic reconnect.')
    (root/'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf8')
    rows, log = [], []
    try:
        token = secrets.token_hex(32)
        ip = None
        sent = False
        with serial.Serial(args.port, 115200, timeout=.5) as device:
            device.dtr = False
            device.rts = True
            time.sleep(.15)
            device.rts = False
            deadline = time.monotonic()+100
            while time.monotonic() < deadline:
                try:
                    line = device.readline().decode('ascii').strip()
                except UnicodeDecodeError:
                    continue
                if line.startswith(('CAMERA_', 'PORTAL_', 'APPLE_', 'AUTH_', 'POST_LOGIN_', 'REDIRECT_HOP=', 'TEST ', 'SENSOR_', 'CAMPUS_', 'READY:')):
                    print(line, flush=True)
                    log.append(line)
                if line == 'AUTH_READY_USB_SECRETS' and not sent:
                    device.write(('\n'.join(v.encode('utf8').hex() for v in values)+'\n').encode('ascii'))
                    device.flush()
                    sent = True
                if line == 'CAMERA_TOKEN_READY':
                    device.write((token+'\n').encode('ascii'))
                    device.flush()
                if line.startswith('CAMERA_HTTP_READY IP='):
                    ip = line.split('IP=', 1)[1].split()[0]
                    if not ipaddress.ip_address(ip).is_private:
                        raise ValueError('Camera address is not private')
                    break
            (root/'startup.log').write_text('\n'.join(log), encoding='utf8')
            if not ip:
                raise TimeoutError('Camera HTTP endpoint not ready')
            # Explicitly bypass system proxies: private camera images must stay on LAN.
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            epoch, start = time.time_ns()//1000000, time.monotonic()
            due = start
            boot, seq, missed = None, -1, 0
            for index in range(args.count):
                time.sleep(max(0, due-time.monotonic()))
                requested = time.monotonic()
                request_at = round((requested-start)*1000)
                request = urllib.request.Request(f'http://{ip}/v1/frame', headers={'Authorization': 'Bearer '+token})
                with client.open(request, timeout=8) as response:
                    if response.status != 200 or response.headers.get_content_type() != 'image/jpeg':
                        raise ValueError('Unexpected camera response')
                    data = response.read(300001)
                    boot, seq, captured = validate_frame(data, response.headers, boot, seq)
                received = time.monotonic()
                frame = root/'frames'/f'{index:06d}.jpg'
                frame.write_bytes(data)
                row = dict(id=f'{recording}:{index}', recordingId=recording, atMs=request_at, sourceAtMs=request_at,
                           frames=[str(frame)], cameraId=plan['cameraId'], direction='front', sequence=index,
                           transport=plan['transport'], timestampSource='host-request', exposureTimeKnown=False,
                           requestAtMs=request_at, receivedAtMs=round((received-start)*1000), requestWallTimeMs=epoch+request_at,
                           sha256=hashlib.sha256(data).hexdigest(), wireSha256=hashlib.sha256(data).hexdigest(),
                           deviceBootId=boot, deviceSequence=seq, deviceCaptureMs=captured, deviceClockAligned=False,
                           width=640, height=480, bytes=len(data), requestToReceiveMs=round((received-requested)*1000))
                with (root/'observations.jsonl').open('a', encoding='utf8') as output:
                    output.write(json.dumps(row)+'\n')
                rows.append(row)
                print(json.dumps(dict(sequence=index, bytes=len(data), latencyMs=row['requestToReceiveMs'])), flush=True)
                due += args.interval
                if received > due:
                    skip = int((received-due)//args.interval)+1
                    missed += skip
                    due += skip*args.interval
            intervals = [b['atMs']-a['atMs'] for a, b in zip(rows, rows[1:])]
            result = dict(status='captured', frames=len(rows), missedScheduleSlots=missed,
                          meanIntervalMs=statistics.mean(intervals) if intervals else None,
                          meanRequestToReceiveMs=statistics.mean(r['requestToReceiveMs'] for r in rows),
                          maxRequestToReceiveMs=max(r['requestToReceiveMs'] for r in rows),
                          meetsRequestedCadence=len(rows)>1 and missed==0, modelCalls=0)
            (root/'complete.json').write_text(json.dumps(result, indent=2), encoding='utf8')
            print(json.dumps(result), flush=True)
    except BaseException as error:
        # Do not dump response objects or request headers that could contain secrets.
        (root/'startup.log').write_text('\n'.join(log), encoding='utf8')
        (root/'stopped.json').write_text(json.dumps(dict(errorType=type(error).__name__, frames=len(rows))), encoding='utf8')
        raise


if __name__ == '__main__':
    main()

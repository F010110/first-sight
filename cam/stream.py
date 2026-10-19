"""Bounded serial JPEG acquisition, independent of model latency. No firmware writes."""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import time
import uuid


def read_frame(port, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = port.readline()
        if line.strip() in (b'CAPTURE_FAILED', b'CAMERA_NOT_READY'):
            raise RuntimeError(line.decode().strip())
        if not line.startswith(b'FRAME '):
            continue
        fields = line.split()
        if len(fields) != 4:
            raise ValueError('Invalid FRAME header')
        size, width, height = map(int, fields[1:])
        if not 0 < size <= 2_000_000 or not 0 < width <= 4096 or not 0 < height <= 4096:
            raise ValueError('Invalid FRAME dimensions/length')
        data = bytearray()
        while len(data) < size and time.monotonic() < deadline:
            chunk = port.read(size - len(data))
            if not chunk:
                continue
            data.extend(chunk)
        if len(data) != size or data[:2] != b'\xff\xd8' or data[-2:] != b'\xff\xd9':
            raise ValueError('Incomplete JPEG')
        # Read the terminator separately; never search for it inside image bytes.
        if port.readline().strip() != b'' or port.readline().strip() != b'END_FRAME':
            raise ValueError('Missing END_FRAME')
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            if image.size != (width, height) or image.format != 'JPEG':
                raise ValueError('JPEG/header mismatch')
            image.load()
        return bytes(data), width, height
    raise TimeoutError('No complete frame before deadline')


def append(path, value):
    with path.open('a', encoding='utf8') as sink:
        sink.write(json.dumps(value, ensure_ascii=False) + '\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path, help='New local directory; contains private original images')
    p.add_argument('--port', default='COM3')
    p.add_argument('--camera-id', default='esp32-s3-front-1')
    p.add_argument('--interval', type=float, default=2)
    p.add_argument('--count', type=int, default=30)
    a = p.parse_args()
    if not math.isfinite(a.interval) or a.interval < .1 or not 1 <= a.count <= 1800:
        p.error('Require interval >= .1s and count 1..1800')
    import serial
    a.output = a.output.resolve()
    a.output.mkdir(parents=True, exist_ok=False)
    (a.output / 'frames').mkdir()
    recording = str(uuid.uuid4())
    plan = dict(schemaVersion=1, recordingId=recording, cameraId=a.camera_id,
                port=a.port, baud=115200, requestedIntervalSeconds=a.interval,
                requestedFrames=a.count, timestampSource='host-request',
                exposureTimeKnown=False, sideCamerasAvailable=False,
                limits='No device timestamp, sequence or wire checksum in existing firmware. Host SHA256 is not a wire checksum. No automatic reconnect across unknown device resets.')
    (a.output / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf8')
    (a.output / 'observations.jsonl').touch()
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = a.port, 115200, .25
    port.dtr = port.rts = False
    rows, missed = [], 0
    try:
        port.open()
        time.sleep(3)
        startup = port.read_all()
        (a.output / 'startup.log').write_bytes(startup)
        epoch, start = time.time_ns() // 1_000_000, time.monotonic()
        due = start
        for seq in range(a.count):
            time.sleep(max(0, due - time.monotonic()))
            requested = time.monotonic()
            request_at = round((requested - start) * 1000)
            port.write(b'c')
            port.flush()
            data, width, height = read_frame(port)
            received = time.monotonic()
            frame = a.output / 'frames' / f'{seq:06d}.jpg'
            frame.write_bytes(data)
            row = dict(id=f'{recording}:{seq}', recordingId=recording, atMs=request_at,
                       sourceAtMs=request_at, frames=[str(frame)], cameraId=a.camera_id,
                       direction='front', sequence=seq, timestampSource='host-request',
                       requestAtMs=request_at, receivedAtMs=round((received-start)*1000),
                       requestWallTimeMs=epoch+request_at, exposureTimeKnown=False,
                       sha256=hashlib.sha256(data).hexdigest(), width=width, height=height,
                       bytes=len(data), requestToReceiveMs=round((received-requested)*1000))
            append(a.output / 'observations.jsonl', row)
            rows.append(row)
            print(json.dumps(dict(sequence=seq, bytes=len(data), latencyMs=row['requestToReceiveMs'])), flush=True)
            due += a.interval
            if received > due:
                skipped = math.floor((received-due)/a.interval)+1
                missed += skipped
                due += skipped*a.interval
        intervals = [b['requestAtMs']-a['requestAtMs'] for a,b in zip(rows,rows[1:])]
        result = dict(status='captured', frames=len(rows), missedScheduleSlots=missed,
                      meanIntervalMs=statistics.mean(intervals) if intervals else None,
                      maxIntervalMs=max(intervals) if intervals else None,
                      meanRequestToReceiveMs=statistics.mean(r['requestToReceiveMs'] for r in rows),
                      maxRequestToReceiveMs=max(r['requestToReceiveMs'] for r in rows),
                      meetsRequestedCadence=len(rows)>1 and missed==0,
                      note='Bounded test only; not exposure-timing or long-term stability certification')
        (a.output/'complete.json').write_text(json.dumps(result, indent=2), encoding='utf8')
        print(json.dumps(result), flush=True)
    except BaseException as error:
        (a.output/'stopped.json').write_text(json.dumps(dict(error=str(error),frames=len(rows))), encoding='utf8')
        raise
    finally:
        port.close()


if __name__ == '__main__':
    main()

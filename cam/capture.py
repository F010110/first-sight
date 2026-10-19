import pathlib
import time
import serial

root = pathlib.Path(__file__).parent / 'local'
root.mkdir(parents=True, exist_ok=True)
s = serial.Serial()
s.port = 'COM3'
s.baudrate = 115200
s.timeout = 2
s.dtr = False
s.rts = False
s.open()
try:
    time.sleep(3)
    print(s.read_all().decode('utf-8', errors='replace'))
    for i in range(3):
        s.write(b'c')
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            line = s.readline()
            print(line.decode('utf-8', errors='replace').strip())
            if line.startswith(b'FRAME '):
                _, size, width, height = line.split()
                size = int(size)
                if not 0 < size < 2000000:
                    raise RuntimeError('Invalid frame length')
                data = bytearray()
                while len(data) < size and time.monotonic() < deadline:
                    data.extend(s.read(size - len(data)))
                if len(data) != size or data[:2] != b'\xff\xd8' or data[-2:] != b'\xff\xd9':
                    raise RuntimeError('Incomplete or invalid JPEG')
                target = root / f'capture-{i+1}.jpg'
                target.write_bytes(data)
                print(f'SAVED {target} {width.decode()}x{height.decode()} {size} bytes')
                break
        else:
            raise RuntimeError('No frame received; inspect camera initialization logs')
finally:
    s.close()

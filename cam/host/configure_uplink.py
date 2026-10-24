"""One-time USB uplink endpoint setup, persisted without embedding host in firmware."""
import argparse
import serial
import time
parser=argparse.ArgumentParser()
parser.add_argument('--host',required=True)
args=parser.parse_args()
if not args.host.startswith('10.122.') or any(c not in '0123456789.' for c in args.host):raise ValueError('Invalid campus host')
with serial.Serial('COM3',115200,timeout=.5) as device:
    device.dtr=False;device.rts=True;time.sleep(.15);device.rts=False
    deadline=time.monotonic()+65
    while time.monotonic()<deadline:
        line=device.readline().decode('ascii',errors='ignore').strip()
        if line.startswith('NETWORK_CAMERA_READY'):break
    else:raise TimeoutError('Camera not ready')
    device.write(f'UPLINK http://{args.host}:8885/v1/upload\n'.encode('ascii'));device.flush()
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        line=device.readline().decode('ascii',errors='ignore').strip()
        if line=='UPLINK_CONFIGURED':print('Persistent uplink endpoint configured');break
    else:raise TimeoutError('Uplink configuration not acknowledged')

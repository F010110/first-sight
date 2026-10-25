"""Commission exactly one identity-bound camera; never overwrite another role's key."""
import argparse
import json
from pathlib import Path
import secrets
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--role', choices=['front','left','right'], required=True)
parser.add_argument('--camera-id', required=True)
parser.add_argument('--port', default='COM3')
args = parser.parse_args()
import re
if not re.fullmatch(r'first-sight-[0-9a-f]{12}', args.camera_id):
    parser.error('Invalid camera ID')
path = Path(__file__).parent.parent/'local'/f'network-camera-{args.role}.json'
config = json.loads(path.read_text(encoding='utf8')) if path.exists() else dict(token=secrets.token_hex(32),host=args.camera_id+'.local',cameraId=args.camera_id,direction=args.role)
if config.get('cameraId') != args.camera_id or config.get('direction') != args.role:
    raise ValueError('Existing role belongs to a different device; refusing overwrite')
# Save key BEFORE sending, so an interrupted commissioning never loses the host key.
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(config),encoding='utf8')
device = serial.Serial(port=None,baudrate=115200,timeout=.5)
device.dtr=False
device.rts=False
device.port=args.port
with device:
    device.rts=True
    time.sleep(.15)
    device.rts=False
    deadline=time.monotonic()+110
    identity_verified=False
    while time.monotonic()<deadline:
        line=device.readline().decode('ascii',errors='ignore').strip()
        if line.startswith('NETWORK_IDENTITY '):
            expected=f'NETWORK_IDENTITY cameraId={args.camera_id} direction={args.role}'
            if line != expected:
                raise ValueError('Connected camera identity/role mismatch; no secrets sent')
            identity_verified=True
        if line=='NETWORK_PAIR_KEY_READY':
            if not identity_verified: raise ValueError('Missing identity; no key sent')
            device.write((config['token']+'\n').encode('ascii'))
            device.flush()
        if line=='NETWORK_CAMPUS_CREDENTIALS_READY':
            if not identity_verified: raise ValueError('Missing identity; no credentials sent')
            credentials=json.loads((path.parent/'campus-credentials.json').read_text(encoding='utf-8-sig'))
            device.write(('\n'.join(credentials[k].encode('utf8').hex() for k in ['username','password'])+'\n').encode('ascii'))
            device.flush()
            del credentials
        if line.startswith('NETWORK_CAMERA_READY IP='):
            if not identity_verified: raise ValueError('Missing identity')
            config['host']=line.split('IP=')[1]
            path.write_text(json.dumps(config),encoding='utf8')
            print('Network camera commissioned; local endpoint saved. Key not logged.')
            break
    else:
        raise TimeoutError('Camera commissioning did not complete; key kept in local config')

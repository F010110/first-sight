"""One-time USB device-key commissioning. Daily reception never opens a serial port."""
import json
from pathlib import Path
import secrets
import time
import serial

path = Path(__file__).parent/'local/network-camera.json'
config = json.loads(path.read_text(encoding='utf8')) if path.exists() else dict(token=secrets.token_hex(32),host='first-sight-cam.local')
# Save key BEFORE sending, so an interrupted commissioning never loses the host key.
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(config),encoding='utf8')
with serial.Serial('COM3',115200,timeout=.5) as device:
    device.dtr=False
    device.rts=True
    time.sleep(.15)
    device.rts=False
    deadline=time.monotonic()+75
    while time.monotonic()<deadline:
        line=device.readline().decode('ascii',errors='ignore').strip()
        if line=='NETWORK_PAIR_KEY_READY':
            device.write((config['token']+'\n').encode('ascii'))
            device.flush()
        if line=='NETWORK_CAMPUS_CREDENTIALS_READY':
            credentials=json.loads((path.parent/'campus-credentials.json').read_text(encoding='utf-8-sig'))
            device.write(('\n'.join(credentials[k].encode('utf8').hex() for k in ['username','password'])+'\n').encode('ascii'))
            device.flush()
            del credentials
        if line.startswith('NETWORK_CAMERA_READY IP='):
            config['host']=line.split('IP=')[1]
            path.write_text(json.dumps(config),encoding='utf8')
            print('Network camera commissioned; local endpoint saved. Key not logged.')
            break
    else:
        raise TimeoutError('Camera commissioning did not complete; key kept in local config')

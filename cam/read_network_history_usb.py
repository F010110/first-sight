"""Read durable network metadata over USB, even with no campus connection."""
import argparse
import json
from pathlib import Path
import time
import serial

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',default='COM3')
parser.add_argument('--reset',action='store_true',help='Explicit reboot to verify persistence')
parser.add_argument('--min-errors',type=int,default=0)
args=parser.parse_args()
with serial.Serial(args.port,115200,timeout=.3) as device:
    if args.reset:
        device.dtr=False;device.rts=True;time.sleep(.15);device.rts=False
    deadline=time.monotonic()+75;next_request=time.monotonic()+2
    while time.monotonic()<deadline:
        if time.monotonic()>=next_request:
            device.write(b'NETWORK_HISTORY\n');device.flush();next_request=time.monotonic()+5
        line=device.readline().decode('ascii',errors='ignore').strip()
        if not line.startswith('{'):continue
        try:value=json.loads(line)
        except ValueError:continue
        if value.get('bootId')!='persistent-history':continue
        errors=[e for e in value['events'] if e['kind']=='disconnect' or (e['kind']=='upload' and e['code']!=200)]
        if len(errors)<args.min_errors:continue
        root=Path('run/network-diagnostics');root.mkdir(parents=True,exist_ok=True)
        path=root/f'usb-{time.time_ns()}.json';path.write_text(json.dumps(value,indent=2),encoding='utf8')
        print(json.dumps(dict(path=str(path),total=value['total'],writeFailed=value['writeFailed'],errors=[e for e in value['events'] if e['kind']=='disconnect' or (e['kind']=='upload' and e['code']!=200)])))
        break
    else:raise TimeoutError('No USB history response; existing metadata not erased')

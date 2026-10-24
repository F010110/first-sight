"""One device-side portal login via USB, never prints or embeds credentials in firmware."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import serial


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', default='COM3')
    parser.add_argument('--confirm-http-credentials', action='store_true', required=True)
    args = parser.parse_args()
    credentials = json.loads((Path(__file__).parent.parent/'local/campus-credentials.json').read_text(encoding='utf-8-sig'))
    values = [credentials.get('username'), credentials.get('password')]
    if any(not isinstance(v, str) or not v or len(v.encode('utf8')) > 1024 for v in values):
        raise ValueError('Invalid local credentials; no credentials sent')
    lines = []
    sent = False
    done = False
    with serial.Serial(args.port, 115200, timeout=.5) as device:
        device.dtr = False
        device.rts = True
        time.sleep(.15)
        device.rts = False
        deadline = time.monotonic()+100
        while time.monotonic() < deadline:
            raw = device.readline()
            try:
                line = raw.decode('ascii').strip()
            except UnicodeDecodeError:
                continue
            # Whitelist diagnostic lines, never raw arbitrary serial data.
            prefixes = ('CAMPUS_PROBE_START', 'PORTAL_', 'APPLE_', 'REDIRECT_HOP=', 'AUTH_', 'POST_LOGIN_', 'PROBE_DONE')
            if not line.startswith(prefixes):
                continue
            print(line, flush=True)
            lines.append(line)
            if line == 'AUTH_READY_USB_SECRETS' and not sent:
                device.write(('\n'.join(v.encode('utf8').hex() for v in values)+'\n').encode('ascii'))
                device.flush()
                sent = True
            if line == 'PROBE_DONE RADIO_OFF':
                done = True
                break
    name = 'campus-portal-login-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.log'
    with (Path(__file__).parent.parent/'local'/name).open('x', encoding='utf8') as output:
        output.write('\n'.join(lines))
    if not done:
        raise RuntimeError('Probe did not finish; no automatic credential retry')
    if not any('INTERNET_CHECK_SUCCESS=1' in line or 'APPLE_SUCCESS_MARKER=1' in line for line in lines):
        raise RuntimeError('Internet access unverified; inspect sanitized probe log')


if __name__ == '__main__':
    main()

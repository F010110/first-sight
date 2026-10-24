"""USB hotspot provisioning. Read private local JSON, never print Wi-Fi secrets."""
import argparse
import ipaddress
import json
from pathlib import Path
import time
import serial

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,default=Path(__file__).parent/'local/android-hotspot.json')
    parser.add_argument('--port',default='COM3')
    parser.add_argument('--connect-only',action='store_true',help='Associate to hotspot with image uploads disabled')
    parser.add_argument('--restore-campus-host',help='Restore campus Wi-Fi and this private computer IPv4')
    args=parser.parse_args()
    if args.restore_campus_host:
        address=ipaddress.IPv4Address(args.restore_campus_host)
        if not address.is_private or address.is_loopback or address.is_link_local:parser.error('Private computer IPv4 required')
        profile=None
    else:
        profile=json.loads(args.config.read_text(encoding='utf-8-sig'))
        if not 1<=len(profile['ssid'].encode())<=32 or not 8<=len(profile['password'].encode())<=63:parser.error('Fill local hotspot SSID (1–32 UTF8 bytes) and WPA2 password (8–63 bytes) first')
        if '\0' in profile['ssid'] or '\0' in profile['password']:parser.error('NUL forbidden')
    with serial.Serial(args.port,115200,timeout=.3) as device:
        device.dtr=False;device.rts=True;time.sleep(.15);device.rts=False
        def wait(expected,seconds=80):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                line=device.readline().decode('ascii',errors='ignore').strip()
                if line==expected:return
                if line.startswith(('HOTSPOT_CONFIG_INVALID','HOTSPOT_CONFIG_SAVE_FAILED')):raise RuntimeError('Device rejected profile')
            raise TimeoutError('No expected device acknowledgement; credentials not printed')
        # A startup marker is before Wi-Fi/Portal blocking. Do not wait for campus login.
        wait('NETWORK_PAIRED')
        if profile is None:
            device.write(f'UPLINK http://{address}:8885/v1/upload\n'.encode());device.flush();wait('UPLINK_CONFIGURED')
            device.write(b'WIFI_CAMPUS\n');device.flush();wait('CAMPUS_PROFILE_CONFIGURED')
            print('Campus profile restored; boot and upload verification still required')
        else:
            device.write(b'WIFI_HOTSPOT_TEST\n' if args.connect_only else b'WIFI_HOTSPOT\n');device.flush();wait('HOTSPOT_SECRETS_READY')
            device.write(profile['ssid'].encode().hex().encode()+b'\n'+profile['password'].encode().hex().encode()+b'\n');device.flush()
            wait('HOTSPOT_CONFIGURED')
            if args.connect_only:print('Hotspot profile saved with uploads OFF. Association not yet verified.')
            else:print('Hotspot profile saved; camera will upload to DHCP gateway:8885. Connection not yet verified.')

if __name__=='__main__':main()

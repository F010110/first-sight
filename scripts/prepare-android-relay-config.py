"""Create private phone import config; never put device secrets in source or APK."""
import ipaddress
import json
from pathlib import Path
import argparse

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--computer-host',default='10.122.241.38')
args=parser.parse_args()
address=ipaddress.IPv4Address(args.computer_host)
if not address.is_private or address.is_loopback or address.is_link_local:
    parser.error('Private reachable computer IPv4 required')
source=Path('cam/local/network-camera.json')
config=json.loads(source.read_text(encoding='utf-8-sig'))
target=Path('cam/local/android-relay-config.json')
target.write_text(json.dumps(dict(host=f'http://{address}:8885',token=config['token'])),encoding='utf8')
print(f'Private import file created: {target}; transfer only to your phone, do not publish it.')

"""Save an authenticated RAM log snapshot; never print pairing credentials."""
import argparse
import json
from pathlib import Path
import time
import urllib.request

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host',required=True,help='Current camera IPv4 address')
args=parser.parse_args()
import ipaddress
address=ipaddress.IPv4Address(args.host)
if not address.is_private:parser.error('Private camera address required')
config=json.loads((Path(__file__).parent/'local/network-camera.json').read_text(encoding='utf-8-sig'))
request=urllib.request.Request(f'http://{address}/v1/network-log',headers={'Authorization':'Bearer '+config['token']})
with urllib.request.urlopen(request,timeout=25) as response:log=json.load(response)
root=Path('run/network-diagnostics');root.mkdir(parents=True,exist_ok=True)
path=root/f'{time.time_ns()}.json'
path.write_text(json.dumps(dict(retrievedWallMs=time.time_ns()//1000000,device=log),ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(dict(path=str(path),events=len(log.get('events',[])),total=log.get('total'))))

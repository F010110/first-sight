"""Paired camera upload receiver. No control/model endpoints exposed to LAN."""
import argparse
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import socket
import sys
import threading
import time
import uuid
from portal_stream import validate_frame
from network_stream import atomic

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--config',type=Path,default=Path(__file__).parent/'local/network-camera.json')
    parser.add_argument('--host',default='10.122.241.38')
    parser.add_argument('--port',type=int,default=8885)
    args=parser.parse_args()
    token=json.loads(args.config.read_text(encoding='utf-8-sig'))['token']
    root=args.output.resolve();root.mkdir(parents=True,exist_ok=False)
    (root/'frames').mkdir();(root/'failed-responses').mkdir();(root/'observations.jsonl').touch()
    recording=str(uuid.uuid4());start=time.monotonic();state=dict(record=False,epoch=0,count=0,boot=None,sequence=-1,lastRecordedDevice=None)
    atomic(root/'plan.json',dict(schemaVersion=1,recordingId=recording,transport='wifi-push-http',usbRequired=False,timestampSource='host-receive-start',exposureTimeKnown=False))
    def control():
        for line in sys.stdin:
            try:
                value=json.loads(line)
                if isinstance(value.get('record'),bool):state['record']=value['record'];state['epoch']+=1
            except (ValueError,TypeError):pass
    threading.Thread(target=control,daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def setup(self):
            super().setup();self.connection.settimeout(8)
        def do_POST(self):
            if self.path!='/v1/upload':self.send_error(404);return
            if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):self.send_error(401);return
            epoch=state['epoch'];record=state['record'];wall=time.time_ns()//1000000;at=round((time.monotonic()-start)*1000);data=b''
            try:
                length=int(self.headers.get('Content-Length','-1'))
                if self.headers.get('Content-Type')!='image/jpeg' or not 0<length<=300000:raise ValueError('Invalid JPEG request')
                while len(data)<length:
                    part=self.rfile.read1(min(16384,length-len(data)))
                    if not part:break
                    data+=part
                sequence=int(self.headers.get('X-Sequence','-1'))
                if sequence<0:raise ValueError('Missing sequence')
                boot,sequence,captured=validate_frame(data,self.headers,None,sequence-1,16)
                if state['boot']==boot and sequence<=state['sequence']:raise ValueError('Duplicate frame')
                gap=state['boot']!=boot or sequence!=state['sequence']+1
                state['boot']=boot;state['sequence']=sequence
                digest=hashlib.sha256(data).hexdigest();index=state['count'];path=root/'frames'/f'{index:09d}.jpg'
                if record and state['record'] and epoch==state['epoch']:
                    path.write_bytes(data)
                    row=dict(id=f'{recording}:{index}',recordingId=recording,sequence=index,atMs=at,sourceAtMs=at,
                             frames=[str(path)],sha256=digest,wireSha256=digest,bytes=len(data),direction='front',
                             transport='wifi-push-http',timestampSource='host-receive-start',exposureTimeKnown=False,
                             receivedAtMs=round((time.monotonic()-start)*1000),requestWallTimeMs=wall,
                             deviceBootId=boot,deviceSequence=sequence,deviceCaptureMs=captured,deviceClockAligned=False,
                             width=640,height=480,jpegQuality=16,gapBefore=gap or state['lastRecordedDevice']!=(boot,sequence-1),
                             wifiRssi=self.headers.get('X-Wifi-Rssi'),wifiChannel=self.headers.get('X-Wifi-Channel'))
                    with (root/'observations.jsonl').open('a',encoding='utf8') as output:output.write(json.dumps(row)+'\n')
                    state['count']+=1;state['lastRecordedDevice']=(boot,sequence)
                print(json.dumps(dict(kind='preview',id=f'{recording}:push:{boot}:{sequence}',atMs=wall,sha256=digest,jpeg=base64.b64encode(data).decode('ascii'))),flush=True)
                atomic(root/'receiver-status.json',dict(state='receiving',transport='push',frames=state['count'],lastReceivedWallMs=time.time_ns()//1000000,usbRequired=False))
                self.send_response(200);self.send_header('Content-Length','2');self.end_headers();self.wfile.write(b'OK')
            except (ValueError,OSError) as error:
                if record and state['record'] and epoch==state['epoch']:
                    name=str(time.time_ns());(root/'failed-responses'/(name+'.bin')).write_bytes(data)
                    atomic(root/'failed-responses'/(name+'.json'),dict(errorType=type(error).__name__,receivedBytes=len(data)))
                self.send_error(400)
    server=HTTPServer((args.host,args.port),Handler)
    atomic(root/'receiver-status.json',dict(state='waiting-for-camera',transport='push',usbRequired=False))
    try:server.serve_forever()
    finally:server.server_close()

if __name__=='__main__':main()

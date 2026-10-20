"""Bounded three-camera HTTP receiver. No radio or model calls; default loopback."""
import argparse
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image

DIRECTIONS = ('front', 'left', 'right')


class Rig:
    def __init__(self, output, devices, count=30, interval=2, timeout=1.5, skew=.25, lead=3):
        if set(devices) != set(DIRECTIONS) or len(set(devices.values())) != 3 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,48}',v) for v in devices.values()):
            raise ValueError('Require three distinct configured camera IDs')
        if not 1 <= count <= 1800 or not .1 <= interval <= 60 or not 0 < skew <= min(timeout,.25) or not timeout < interval:
            raise ValueError('Invalid count/timing policy')
        self.root=Path(output).resolve();self.root.mkdir(parents=True,exist_ok=False)
        (self.root/'frames').mkdir();(self.root/'observations.jsonl').touch()
        self.devices=devices;self.count=count;self.interval=interval;self.timeout=timeout;self.skew=skew
        self.start=time.monotonic()+lead;self.recording=str(uuid.uuid4());self.lock=threading.Lock()
        self.rounds={};self.boots={};self.sequences={};self.done=threading.Event();self.published=0;self.missing=0
        plan=dict(schemaVersion=1,transport='wifi-http',recordingId=self.recording,devices=devices,
                  requestedFrames=count,requestedIntervalSeconds=interval,timestampSource='host-request',
                  exposureTimeKnown=False,maxDispatchSkewMs=skew*1000,roundDeadlineMs=timeout*1000,
                  policy='Complete front/left/right request rounds only; dispatch-aligned, NOT exposure-synchronized')
        (self.root/'plan.json').write_text(json.dumps(plan,indent=2),encoding='utf8')

    def event(self,value):
        with (self.root/'events.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(value)+'\n')

    def next(self,device,boot,now=None):
        now=time.monotonic() if now is None else now
        with self.lock:
            self.identity(device,boot)
            if self.done.is_set():return 'DONE\n'
            index=int((now-self.start)//self.interval)
            if now<self.start or index>=self.count or now>=self.start+index*self.interval+self.timeout:return 'WAIT\n'
            row=self.rounds.setdefault(index,{'dispatch':{},'frames':{}})
            if row.get('closed') or device in row['frames']:return 'WAIT\n'
            row['dispatch'].setdefault(device,now)
            return f'CAPTURE {index}\n'

    def identity(self,device,boot):
        if device not in self.devices.values() or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',boot):raise ValueError('Unknown device/invalid boot ID')
        if device in self.boots and self.boots[device]!=boot:raise ValueError('Device rebooted; start a new recording')
        self.boots[device]=boot

    def frame(self,device,boot,index,sequence,data,digest,device_ms,source_kind='unattested-device'):
        if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Wire SHA256 mismatch')
        with Image.open(io.BytesIO(data)) as image:
            if image.format!='JPEG' or image.size!=(640,480):raise ValueError('Require 640x480 JPEG')
            image.load()
        with self.lock:
            self.identity(device,boot)
            row=self.rounds.get(index);now=time.monotonic()
            if not row or row.get('closed') or device not in row['dispatch'] or now>=self.start+index*self.interval+self.timeout:raise ValueError('Unrequested/expired round')
            if device in row['frames'] or sequence<=self.sequences.get(device,-1):raise ValueError('Duplicate/out-of-order device sequence')
            if sequence<0 or not 0<=device_ms<=0xffffffff:raise ValueError('Invalid device sequence/time')
            direction=next(k for k,v in self.devices.items() if v==device)
            path=self.root/'frames'/f'{index:06d}-{direction}.jpg';path.write_bytes(data)
            self.sequences[device]=sequence
            item=dict(direction=direction,cameraId=device,bootId=boot,deviceSequence=sequence,
                      sourceKind='synthetic-protocol-test' if source_kind=='synthetic-protocol-test' else 'unattested-device',
                      deviceCaptureMs=device_ms,deviceClockAligned=False,frame=str(path),
                      requestAtMs=round((row['dispatch'][device]-self.start)*1000),
                      receivedAtMs=round((now-self.start)*1000),sha256=digest,bytes=len(data))
            row['frames'][device]=item;self.event(dict(kind='frame',round=index,**item))

    def close_round(self,index):
        # Called in order by the timer, including rounds in which no camera arrived.
        with self.lock:
            row=self.rounds.setdefault(index,{'dispatch':{},'frames':{}})
            if row.get('closed'):return
            row['closed']=True
            missing=[d for d in DIRECTIONS if self.devices[d] not in row['frames']]
            dispatch=list(row['dispatch'].values())
            skew=max(dispatch)-min(dispatch) if dispatch else None
            if missing or skew is None or skew>self.skew:
                self.missing+=1;self.event(dict(kind='round-rejected',round=index,missing=missing,dispatchSkewMs=None if skew is None else skew*1000));return
            cameras=[row['frames'][self.devices[d]] for d in DIRECTIONS]
            at_ms=min(c['requestAtMs'] for c in cameras)
            receipt=dict(id=f'{self.recording}:{index}',recordingId=self.recording,sequence=self.published,
                         roundId=index,transport='wifi-http',atMs=at_ms,sourceAtMs=at_ms,
                         frames=[c['frame'] for c in cameras],cameras=cameras,
                         timestampSource='host-request',exposureTimeKnown=False,
                         dispatchSkewMs=round(skew*1000),maxDispatchSkewMs=self.skew*1000)
            with (self.root/'observations.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(receipt)+'\n')
            self.published+=1

    def run(self):
        try:
            for index in range(self.count):
                time.sleep(max(0,self.start+index*self.interval+self.timeout-time.monotonic()))
                self.close_round(index)
            result=dict(status='captured',frames=self.published,requestedRounds=self.count,
                        missingRounds=self.missing,exposureSynchronizationVerified=False)
            (self.root/'complete.json').write_text(json.dumps(result,indent=2),encoding='utf8')
        except BaseException as error:
            (self.root/'stopped.json').write_text(json.dumps(dict(error=str(error),frames=self.published)),encoding='utf8')
        finally:self.done.set()


def handler(rig,token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass  # Do not log bearer credentials or image bodies.
        def reply(self,status,body):
            data=body.encode();self.send_response(status);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def authorized(self):return hmac.compare_digest(self.headers.get('Authorization','').encode('utf8'),('Bearer '+token).encode('utf8'))
        def do_GET(self):
            if not self.authorized():return self.reply(401,'Unauthorized\n')
            parts=self.path.split('/')
            if len(parts)!=5 or parts[1:3]!=['v1','next']:return self.reply(404,'Not found\n')
            try:self.reply(200,rig.next(parts[3],parts[4]))
            except ValueError as error:self.reply(409,str(error)+'\n')
        def do_POST(self):
            if not self.authorized():return self.reply(401,'Unauthorized\n')
            if self.path!='/v1/frame':return self.reply(404,'Not found\n')
            try:
                if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type')!='image/jpeg':raise ValueError('Require fixed-length image/jpeg')
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=300000:raise ValueError('Invalid body size')
                self.connection.settimeout(3);data=self.rfile.read(size)
                if len(data)!=size:raise ValueError('Truncated upload')
                rig.frame(self.headers.get('X-Camera-Id',''),self.headers.get('X-Boot-Id',''),
                          int(self.headers.get('X-Round-Id','-1')),int(self.headers.get('X-Sequence','-1')),
                          data,self.headers.get('X-Frame-Sha256',''),int(self.headers.get('X-Capture-Ms','-1')),self.headers.get('X-Source-Kind','unattested-device'))
                self.reply(200,'STORED\n')
            except (ValueError,OSError,Image.DecompressionBombError) as error:
                rig.event(dict(kind='upload-rejected',error=str(error)));self.reply(409,'Upload rejected\n')
    return Handler


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path)
    p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=8890)
    p.add_argument('--allow-lan',action='store_true');p.add_argument('--count',type=int,default=30)
    p.add_argument('--interval',type=float,default=2);p.add_argument('--deadline',type=float,default=1.5)
    p.add_argument('--max-skew',type=float,default=.25)
    a=p.parse_args();token=os.environ.get('FIRST_SIGHT_CAMERA_TOKEN','')
    if len(token)<24:p.error('Set FIRST_SIGHT_CAMERA_TOKEN (at least 24 characters); do not commit it')
    if a.host not in ('127.0.0.1','localhost') and not a.allow_lan:p.error('LAN binding requires --allow-lan; use trusted isolated network, HTTP is not encrypted')
    rig=Rig(a.output,dict(front='cam-front',left='cam-left',right='cam-right'),a.count,a.interval,a.deadline,a.max_skew)
    server=ThreadingHTTPServer((a.host,a.port),handler(rig,token));server.daemon_threads=True
    threading.Thread(target=server.serve_forever,daemon=True).start()
    print(f'Receiver on {a.host}:{a.port}; NO exposure synchronization claim',flush=True)
    try:rig.run()
    finally:server.shutdown();server.server_close()


if __name__=='__main__':main()

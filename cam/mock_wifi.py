"""Three synthetic JPEG senders for LOCAL protocol tests, not real camera evidence."""
import argparse
import hashlib
import io
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from PIL import Image, ImageDraw


def sender(server,device,token,seconds):
    boot='mock-'+uuid.uuid4().hex;sequence=0;last=-1;deadline=time.monotonic()+seconds
    image=Image.new('RGB',(640,480),{'cam-front':'navy','cam-left':'darkgreen','cam-right':'maroon'}[device])
    ImageDraw.Draw(image).text((40,40),'SYNTHETIC PROTOCOL TEST: '+device,fill='white')
    buffer=io.BytesIO();image.save(buffer,format='JPEG');data=buffer.getvalue()
    while time.monotonic()<deadline:
        headers={'Authorization':'Bearer '+token}
        try:
            request=urllib.request.Request(server+'/v1/next/'+device+'/'+boot,headers=headers)
            with urllib.request.urlopen(request,timeout=3) as response:command=response.read().decode().strip()
            if command=='DONE':return
            if command.startswith('CAPTURE '):
                index=int(command.split()[1])
                if index>last:
                    last=index
                    headers.update({'Content-Type':'image/jpeg','X-Camera-Id':device,'X-Boot-Id':boot,'X-Source-Kind':'synthetic-protocol-test',
                                    'X-Round-Id':str(index),'X-Sequence':str(sequence),'X-Capture-Ms':str(sequence*2000),
                                    'X-Frame-Sha256':hashlib.sha256(data).hexdigest()})
                    with urllib.request.urlopen(urllib.request.Request(server+'/v1/frame',data=data,headers=headers),timeout=3) as response:
                        if response.status!=200:raise RuntimeError('Upload failed')
                    sequence+=1
        except urllib.error.URLError as error:
            if sequence: return  # Receiver closes after its bounded recording.
            raise error
        time.sleep(.03)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--server',default='http://127.0.0.1:8890');p.add_argument('--seconds',type=int,default=70);a=p.parse_args()
    if not a.server.startswith('http://127.0.0.1:'):p.error('Synthetic sender is restricted to loopback')
    token=os.environ.get('FIRST_SIGHT_CAMERA_TOKEN','')
    if len(token)<24:p.error('Set FIRST_SIGHT_CAMERA_TOKEN')
    failures=[]
    def run(device):
        try:sender(a.server,device,token,a.seconds)
        except Exception as error:failures.append((device,str(error)))
    threads=[threading.Thread(target=run,args=(device,)) for device in ('cam-front','cam-left','cam-right')]
    for thread in threads:thread.start()
    for thread in threads:thread.join()
    if failures:raise RuntimeError(failures)


if __name__=='__main__':main()

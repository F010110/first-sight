"""One-time ESP→computer reachability test. No firewall changes or image upload."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import secrets
import threading
import time
import serial

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',required=True)
    parser.add_argument('--port',type=int,default=8885)
    args=parser.parse_args()
    if not args.host.startswith('10.122.'):
        parser.error('Probe restricted to current campus address range')
    nonce=secrets.token_hex(16)
    received=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path!='/probe/'+nonce:
                self.send_error(404);return
            self.send_response(200);self.send_header('Content-Length','2');self.end_headers();self.wfile.write(b'OK');received.set()
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with serial.Serial('COM3',115200,timeout=.5) as device:
            # Explicit reset makes probe execution observable, without resending secrets.
            device.dtr=False;device.rts=True;time.sleep(.15);device.rts=False
            ready=False
            deadline=time.monotonic()+55
            while time.monotonic()<deadline:
                line=device.readline().decode('ascii',errors='ignore').strip()
                if line.startswith('NETWORK_CAMERA_READY'):
                    ready=True;break
            if not ready:
                print({'computerReceivedProbe':False,'deviceReady':False,'deviceHttpStatus':None,'firewallChanged':False,'imagesSent':False})
                return
            device.write(f'PROBE http://{args.host}:{args.port}/probe/{nonce}\n'.encode('ascii'));device.flush()
            end=time.monotonic()+15
            status=None
            while time.monotonic()<end:
                line=device.readline().decode('ascii',errors='ignore').strip()
                if line.startswith('UPLINK_PROBE_HTTP='):
                    status=line.split('=',1)[1];break
            print({'computerReceivedProbe':received.is_set(),'deviceReady':ready,'deviceHttpStatus':status,'firewallChanged':False,'imagesSent':False})
    finally:
        server.shutdown();server.server_close();thread.join()

if __name__=='__main__':main()

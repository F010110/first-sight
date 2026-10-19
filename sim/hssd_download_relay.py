"""Loopback-only byte receiver for public pinned HSSD downloads via tool HTTP.

Workstation proxy TLS failed. Accept only repository-inventory paths, no code,
credentials, arbitrary filesystem writes or remote shell. Stop after acquisition.
"""
import json
import posixpath
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from download_hssd import ROOT, SCENES

inventory = {f['rfilename'] for f in json.loads(Path('run/hssd-catalog-v1/repository.json').read_text())['siblings']}
handles = {posixpath.basename(p).removesuffix('.object_config.json'):p for p in inventory if p.endswith('.object_config.json')}
configs = {'hssd-hab.scene_dataset_config.json', 'semantics/hssd-hab_semantic_lexicon.json'}
for scene in SCENES:
    path = f'scenes/{scene}.scene_instance.json'
    data = json.loads((Path('run/hssd-catalog-v1')/path).read_text())
    configs.update([path,data['stage_instance']['template_name']+'.stage_config.json',f'semantics/scenes/{scene}.semantic_config.json'])
    configs.update(handles[row['template_name']] for row in data['object_instances'])


def asset_paths():
    result = set()
    for path in configs:
        if not (ROOT/path).exists():
            continue
        data = json.loads((ROOT/path).read_text())
        for key in ['render_asset','collision_asset','semantic_asset']:
            if data.get(key):
                result.add(posixpath.normpath(posixpath.join(posixpath.dirname(path),data[key])))
    if not result <= inventory:
        raise ValueError('Unresolved repository asset')
    return result


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        paths = configs if self.path == '/configs' else asset_paths() if self.path == '/assets' else set()
        if self.path not in ['/configs','/assets']:
            self.send_error(404); return
        data = json.dumps({'paths':sorted(p for p in paths if not (ROOT/p).exists()),'total':len(paths)}).encode()
        self.send_response(200); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        path = self.headers.get('X-Asset-Path','')
        allowed = configs | asset_paths()
        size = int(self.headers.get('Content-Length','0'))
        if self.path != '/receive' or path not in allowed or size <= 0 or size > 256*1024*1024:
            self.send_error(400); return
        target = ROOT/path; target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():
            self.send_error(409); return
        temporary = target.with_suffix(target.suffix+'.relay-partial')
        remaining = size
        with temporary.open('wb') as sink:
            while remaining:
                chunk = self.rfile.read(min(1024*1024,remaining))
                if not chunk:
                    self.send_error(400); return
                sink.write(chunk); remaining -= len(chunk)
        if path in configs:
            json.loads(temporary.read_text())
        temporary.replace(target)
        self.send_response(201); self.send_header('Content-Length','0'); self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ROOT.mkdir(parents=True,exist_ok=True)
    print('HSSD byte relay on 127.0.0.1:8931; only six-scene dependency paths accepted',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8931),Handler).serve_forever()

"""Download two explicit Ground trajectories, never the full dataset."""
import json
import hashlib
import urllib.request
from pathlib import Path
import argparse
import time

def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=90) as response:return response.read()
        except Exception:
            if attempt==2:raise
            time.sleep(2**attempt)

def main(root):
    root.mkdir(parents=True,exist_ok=True)
    repo='theairlabcmu/TartanGround'
    meta=json.loads(get('https://huggingface.co/api/datasets/'+repo))
    if meta.get('gated'):raise RuntimeError('Authentication required; stop for user')
    revision=meta['sha']
    manifest=get('https://raw.githubusercontent.com/castacks/tartanairpy/main/tartanair/download_ground_files.txt')
    (root/'source-file-list.txt').write_bytes(manifest)
    selected=[]
    for line in manifest.decode().splitlines():
        name=line.split()[0]
        if any(name.startswith(e+'/Data_omni/P0000/') for e in ['AbandonedSchool','ModularNeighborhoodIntExt']) and any(v in name for v in ['image_lcam_front.zip','image_lcam_left.zip','image_lcam_right.zip','meta']):selected.append(name)
    assert len(selected)>=6
    plan={'repo':repo,'revision':revision,'files':selected,'manifestSha256':hashlib.sha256(manifest).hexdigest(),'purpose':'raw ground trajectory pilot, not eight-hour independent human recording'}
    (root/'plan.json').write_text(json.dumps(plan,indent=2))
    verified=[]
    for name in selected:
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
        tree=json.loads(get(f'https://huggingface.co/api/datasets/{repo}/tree/{revision}/'+name.rsplit('/',1)[0]))
        entry=next(e for e in tree if e['path']==name)
        size=entry['size'];digest=entry.get('lfs',{}).get('oid')
        if not digest:raise RuntimeError('Missing source SHA256')
        partial=target.with_suffix('.zip.partial')
        if not target.exists():
            for attempt in range(3):
                try:
                    offset=partial.stat().st_size if partial.exists() else 0
                    request=urllib.request.Request(f'https://huggingface.co/datasets/{repo}/resolve/{revision}/{name}',headers={'Range':f'bytes={offset}-'})
                    with urllib.request.urlopen(request,timeout=120) as response:
                        if response.status==206:
                            if not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise ValueError('Bad resume response')
                        else:offset=0
                        with partial.open('ab' if offset else 'wb') as output:
                            while block:=response.read(4*1024*1024):output.write(block)
                    break
                except Exception:
                    if attempt==2:raise
                    time.sleep(2**attempt)
            candidate=partial
        else:candidate=target
        with candidate.open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
        if candidate.stat().st_size!=size or actual!=digest:raise RuntimeError('Source mismatch: '+name)
        if candidate==partial:partial.rename(target)
        verified.append({'path':name,'bytes':size,'sha256':actual})
        (root/'verified.json').write_text(json.dumps(verified,indent=2));print('Verified '+name,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);main(p.parse_args().output)

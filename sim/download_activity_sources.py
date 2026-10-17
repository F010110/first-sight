"""Bounded, hash-verified RGB material for three long composite activity samples."""
import argparse
import concurrent.futures
import json
import os
import urllib.request
from pathlib import Path
from download_ground_pilot import get
from salad_features import sha

def download(catalog_path, output, outdoor_only=False):
    catalog=json.loads(catalog_path.read_text());rows=catalog['trajectories'];selected=[r for r in rows if r['environment'] in ['AbandonedSchool','Hospital','ModularNeighborhoodIntExt']]
    community=sum(r['durationSeconds'] for r in selected if r['environment']=='ModularNeighborhoodIntExt')
    for row in sorted((r for r in rows if r['environment']=='Supermarket'),key=lambda r:(-r['durationSeconds'],r['trajectory'])):
        if community>=1200:break
        selected.append(row);community+=row['durationSeconds']
    if outdoor_only:selected=[r for r in rows if r['environment']=='OldTownSummer']
    total=sum(r['rgbBytes'] for r in selected)
    if total>(10_000_000_000 if outdoor_only else 90_000_000_000):raise ValueError('RGB download budget exceeded')
    if any(len(r['rgbFiles'])!=3 for r in selected):raise ValueError('Three native views required')
    plan={'repo':catalog['repo'],'revision':catalog['revision'],'rgbBytes':total,'trajectories':selected,'minimumActiveSecondsPerSample':None if outdoor_only else 1200,'note':'Auxiliary outdoor city-walk clips, not a standalone full sample.' if outdoor_only else 'Three independent activity samples: school, hospital, neighborhood plus explicitly off-camera trip to shop. No continuous-space claim between different environments. RGB selection based on duration, not model outcomes.'}
    if output.exists():
        if json.loads((output/'plan.json').read_text())!=plan:raise ValueError('Resume plan mismatch')
    else:
        output.mkdir(parents=True);(output/'plan.json').write_text(json.dumps(plan,indent=2))
    print('RGB plan GB',total/1e9,flush=True)
    def fetch(row):
        directory=row['metadataPath'].rsplit('/',1)[0];tree=json.loads(get(f"https://huggingface.co/api/datasets/{catalog['repo']}/tree/{catalog['revision']}/{directory}"));verified=[]
        for name in row['rgbFiles']:
            entry=next(e for e in tree if e['path']==name);digest=entry.get('lfs',{}).get('oid');size=entry['size']
            if not digest or size>3_000_000_000:raise ValueError('Source hash/file size budget invalid')
            path=output/name;path.parent.mkdir(parents=True,exist_ok=True)
            if path.exists():
                if path.stat().st_size!=size or sha(path)!=digest:raise ValueError('Existing RGB integrity mismatch')
                verified.append({'path':name,'bytes':size,'sha256':digest});continue
            caches=[Path('D:/Datasets/TartanGround')/root/name for root in ['pilot-v1','school-independent-p0007-v1','school-heldout-p0009-v1']]
            for cache in caches:
                if cache.exists() and cache.stat().st_size==size and sha(cache)==digest:
                    os.link(cache,path);break
            if not path.exists():
                partial=path.with_suffix('.zip.partial')
                for attempt in range(3):
                    try:
                        offset=partial.stat().st_size if partial.exists() else 0
                        req=urllib.request.Request(f"https://huggingface.co/datasets/{catalog['repo']}/resolve/{catalog['revision']}/{name}",headers={'Range':f'bytes={offset}-'})
                        with urllib.request.urlopen(req,timeout=120) as response:
                            if response.status==206:
                                if not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise ValueError('Invalid resume')
                            else:offset=0
                            with partial.open('ab' if offset else 'wb') as stream:
                                while block:=response.read(4*1024*1024):stream.write(block)
                        break
                    except Exception:
                        if attempt==2:raise
                if partial.stat().st_size!=size or sha(partial)!=digest:raise ValueError('RGB source integrity mismatch')
                partial.rename(path)
            verified.append({'path':name,'bytes':size,'sha256':digest});print('Verified',name,flush=True)
        metadata_source=catalog_path.parent/row['metadataPath'];metadata_target=output/row['metadataPath']
        if not metadata_target.exists():os.link(metadata_source,metadata_target)
        (output/directory/'verified.json').write_text(json.dumps(verified,indent=2));return verified
    with concurrent.futures.ThreadPoolExecutor(max_workers=1 if outdoor_only else 3) as pool:result=list(pool.map(fetch,selected))
    (output/'complete.json').write_text(json.dumps({'trajectories':len(selected),'rgbBytes':total,'verified':result},indent=2));print('All RGB sources verified',len(selected),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('catalog',type=Path);p.add_argument('output',type=Path);p.add_argument('--outdoor-only',action='store_true');a=p.parse_args();download(a.catalog,a.output,a.outdoor_only)

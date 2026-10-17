"""Pinned metadata-first source survey. No images/models or guessed durations."""
import argparse
import concurrent.futures
import hashlib
import io
import json
import zipfile
from pathlib import Path
from download_ground_pilot import get

ENVS=['AbandonedSchool','Hospital','ModularNeighborhoodIntExt','OldTownSummer','Office','Supermarket']

def survey(output):
    output.mkdir(parents=True,exist_ok=False)
    repo='theairlabcmu/TartanGround';meta=json.loads(get('https://huggingface.co/api/datasets/'+repo))
    if meta.get('gated'):raise ValueError('Source requires authorization; do not sign for user')
    revision=meta['sha'];manifest=get('https://raw.githubusercontent.com/castacks/tartanairpy/main/tartanair/download_ground_files.txt')
    (output/'source-file-list.txt').write_bytes(manifest)
    card=get(f'https://huggingface.co/datasets/{repo}/raw/{revision}/README.md');(output/'README.source.md').write_bytes(card)
    names=[l.split()[0] for l in manifest.decode().splitlines() if any(l.startswith(e+'/Data_omni/') for e in ENVS) and l.split()[0].endswith('/metadata.zip')]
    if not 1<=len(names)<=80:raise ValueError('Metadata source count budget exceeded')
    def read(name):
        tree=json.loads(get(f'https://huggingface.co/api/datasets/{repo}/tree/{revision}/'+name.rsplit('/',1)[0]));entry=next(x for x in tree if x['path']==name)
        if entry['size']>10*1024*1024:raise ValueError('Metadata per-file budget exceeded')
        raw=get(f'https://huggingface.co/datasets/{repo}/resolve/{revision}/{name}');digest=hashlib.sha256(raw).hexdigest()
        if digest!=entry.get('lfs',{}).get('oid') or len(raw)!=entry['size']:raise ValueError('Source metadata integrity mismatch')
        path=output/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            trajectory=name.split('/')[-2];m=json.loads(z.read(trajectory+'_metadata.json'));frames=len(z.read('pose_lcam_front.txt').splitlines())
        return {'environment':name.split('/')[0],'trajectory':trajectory,'metadataPath':name,'metadataSha256':digest,'frames':frames,'durationSeconds':(frames-1)*m['time_step'],'timeStep':m['time_step'],'pathLengthM':m.get('path_length'),'rgbFiles':[e['path'] for e in tree if e['path'].endswith(tuple('image_lcam_'+v+'.zip' for v in ['front','left','right']))],'rgbBytes':sum(e['size'] for e in tree if e['path'].endswith(tuple('image_lcam_'+v+'.zip' for v in ['front','left','right'])))}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(read,names))
    report={'repo':repo,'revision':revision,'manifestSha256':hashlib.sha256(manifest).hexdigest(),'trajectories':rows,'environmentTotals':{e:{'minutes':sum(r['durationSeconds'] for r in rows if r['environment']==e)/60,'trajectories':sum(r['environment']==e for r in rows)} for e in ENVS},'note':'Actual source durations, no repeat/retiming. Indoor/outdoor semantics still require RGB review. Ground robot motion is not human-wearer recording. Terms retained; no implied redistribution/cloud permission.'}
    (output/'catalog.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['environmentTotals'],indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);survey(p.parse_args().output)

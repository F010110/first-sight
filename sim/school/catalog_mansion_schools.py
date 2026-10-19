"""Inspect source geometry, not navigation truth. Extract only two candidate schools."""
import argparse
import json
from pathlib import Path
import zipfile


def area(points):
    return abs(sum(a['x']*b['z']-b['x']*a['z'] for a,b in zip(points,points[1:]+points[:1])))/2 if points else 0


def main(root,output):
    output.mkdir(parents=True,exist_ok=False)
    rows=[]
    with zipfile.ZipFile(root/'mansionworld.zip') as archive:
        scenes=sorted({n.split('/')[1] for n in archive.namelist() if '/public_education_' in n})
        for scene in scenes:
            floors=[];assets=set()
            for name in archive.namelist():
                if not name.startswith('mansionworld/'+scene+'/') or not name.endswith('.json'):continue
                data=json.loads(archive.read(name));rooms=data.get('rooms',[])
                def collect(objects):
                    for obj in objects:
                        if obj.get('assetId'):assets.add(obj['assetId'])
                        collect(obj.get('children',[]))
                collect(data.get('objects',[]));collect(data.get('doors',[]))
                floors.append({'file':name,'rooms':[{'id':r.get('id'),'type':r.get('roomType'),'polygonAreaM2':area(r.get('floorPolygon',[]))} for r in rooms],'exteriorDoors':sum('exterior' in [d.get('room0'),d.get('room1')] for d in data.get('doors',[]))})
            rows.append({'scene':scene,'floors':floors,'roomCount':sum(len(f['rooms']) for f in floors),'polygonAreaM2':sum(r['polygonAreaM2'] for f in floors for r in f['rooms']),'assets':sorted(assets),'outdoorNavigability':'unverified','connectivity':'unverified'})
        ranked=sorted(rows,key=lambda r:(-sum('classroom' in str(room).lower() for f in r['floors'] for room in f['rooms']),abs(r['polygonAreaM2']-1200)))
        selected=[ranked[0]]
        selected.append(next(r for r in ranked[1:] if r['scene'].split('#')[0]!=selected[0]['scene'].split('#')[0]))
        for row in selected:
            for name in archive.namelist():
                if name.startswith('mansionworld/'+row['scene']+'/') and not name.endswith('/'):
                    target=output/'selected'/row['scene']/Path(name).name
                    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(name))
    report={'candidates':rows,'selected':[r['scene'] for r in selected],'warning':'Polygon area is not navigable area; education labels and exterior doors do not prove a connected outdoor campus.'}
    (output/'catalog.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps({'count':len(rows),'selected':[{k:r[k] for k in ['scene','roomCount','polygonAreaM2']} for r in selected]},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('output',type=Path);a=p.parse_args();main(a.root,a.output)

"""Source-assisted, evaluation-only annotation. Never fills unseen room labels."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path
from salad_features import sha

def loadlines(path):return [json.loads(line) for line in path.read_text(encoding='utf8').splitlines() if line.strip()]

def original_image_hashes(directory, indices):
    result={index:{} for index in indices}
    for view in ('front','left','right'):
        with zipfile.ZipFile(directory/f'image_lcam_{view}.zip') as z:
            members={int(Path(name).name.split('_')[0]):name for name in z.namelist() if name.endswith('.png')}
            for index in indices:result[index][view]=hashlib.sha256(z.read(members[index])).hexdigest()
    return result

def annotate(sample, sources, spec_path, output):
    spec=json.loads(spec_path.read_text());manifest=json.loads((sample/'complete.json').read_text())
    plan=json.loads((sources/'plan.json').read_text());observations=loadlines(sample/'observations.jsonl')
    truth={r['observationId']:r for r in loadlines(sample/'evaluation-only'/'source-truth.jsonl')}
    episodes=json.loads((sample/'evaluation-only'/'episodes.json').read_text())
    if manifest['sourceRevision']!=plan['revision']:raise ValueError('Source revision mismatch')
    if len(truth)!=len(observations) or len({o['id'] for o in observations})!=len(observations):raise ValueError('Truth/observation mismatch')
    output.mkdir(parents=True,exist_ok=False);annotations=[];anchors=[];audits=[];previous_end=None
    for episode in episodes:
        trajectory=episode['sourceTrajectory'];row=next(r for r in plan['trajectories'] if r['trajectory']==trajectory and r['environment']==episode['worldInstanceId'])
        archive=sources/row['metadataPath']
        if sha(archive)!=row['metadataSha256']:raise ValueError('Source metadata hash mismatch')
        with zipfile.ZipFile(archive) as z:
            metadata=json.loads(z.read(trajectory+'_metadata.json'));config=z.read('collection_config.yaml')
            poses=[[float(v) for v in line.split()] for line in z.read('pose_lcam_front.txt').decode().splitlines() if line.strip()]
        dt=metadata['time_step'];height=metadata['robot_height']
        if len(poses)!=metadata['num_poses'] or len(poses)!=row['frames']:raise ValueError('Native frame count mismatch')
        if episode['endMs']-episode['startMs']!=round((len(poses)-1)*dt*1000):raise ValueError('Episode duration mismatch')
        selected=[o for o in observations if o['episodeId']==episode['id']]
        expected=list(range(0,len(poses),max(1,round(2/dt))))
        if expected[-1]!=len(poses)-1:expected.append(len(poses)-1)
        if len(expected)!=len(selected):raise ValueError('Sampling count mismatch')
        native_hashes=original_image_hashes(archive.parent,expected)
        if previous_end is not None and episode['startMs']-previous_end!=episode['unobservedGapBeforeMs']:raise ValueError('Gap mismatch')
        previous_end=episode['endMs']
        reviewed=selected[::10]+([selected[-1]] if selected[-1] not in selected[::10] else [])
        labels=spec['trajectories'][trajectory]
        if len(labels)!=len(reviewed):raise ValueError('Review anchors/spec length mismatch')
        semantics={o['id']:label for o,label in zip(reviewed,labels)}
        for o,index in zip(selected,expected):
            t=truth[o['id']];uid=f"{plan['revision']}/{episode['worldInstanceId']}/{trajectory}/{index}"
            if t['sourceFrameUid']!=uid or hashlib.sha256(uid.encode()).hexdigest()[:24]!=o['id'] or t['sourcePose']!=poses[index]:raise ValueError('Source pose/ID binding mismatch')
            if o['sourceAtMs']!=round(index*dt*1000) or o['atMs']!=episode['startMs']+o['sourceAtMs']:raise ValueError('Source/activity clock mismatch')
            if set(o['cameras'])!={'front','left','right'}:raise ValueError('Three original views required')
            for view,path in o['cameras'].items():
                if sha(sample/path)!=o['sha256'][view] or o['sha256'][view]!=native_hashes[index][view]:raise ValueError('Image hash mismatch against native archive')
            label=semantics.get(o['id'])
            a={'observationId':o['id'],'trajectory':trajectory,'sourceAtMs':o['sourceAtMs'],'atMs':o['atMs'],'sourceFrameIndex':index,'sourceXYZ':poses[index][:3],'robotHeightM':height,'sourceZPlusRobotHeightM':round(poses[index][2]+height,5),'regionLabel':label,'physicalPlaceId':None,'floorId':None,'status':'assistant-visual-anchor' if label else 'source-verified-semantic-unreviewed','sourceVerified':True,'reviewer':'assistant' if label else None}
            annotations.append(a)
            if label:anchors.append(a)
        audits.append({'trajectory':trajectory,'metadataSha256':sha(archive),'collectionConfigSha256':hashlib.sha256(config).hexdigest(),'nativeFrameCount':len(poses),'sourceTimeStep':dt,'robotHeightM':height,'observations':len(selected),'reviewAnchors':len(reviewed),'durationSeconds':(len(poses)-1)*dt})
    # Complete records do not imply complete semantic annotations.
    (output/'annotations.jsonl').write_text('\n'.join(json.dumps(r) for r in annotations)+'\n')
    (output/'anchors.json').write_text(json.dumps(anchors,indent=2))
    p7={a['sourceAtMs']:a for a in annotations if a['trajectory']=='P0007'}
    diagnostic=None
    if 26000 in p7 and 80000 in p7:
        dz=abs(p7[26000]['sourceXYZ'][2]-p7[80000]['sourceXYZ'][2])
        diagnostic={'a':p7[26000]['observationId'],'b':p7[80000]['observationId'],'sourceDeltaZAbsM':dz,'samePhysicalLevel':False if dz>3 else None,'basis':'same native trajectory vertical separation; actual school sequence has visible stair traversal. Absolute floor numbers are not inferred.','annotationStatus':'assistant-source-assisted','note':'This is a different-level diagnostic, not a universal 3D distance room classifier.'}
    report={'version':spec['version'],'sampleId':manifest['sampleId'],'sourceRevision':plan['revision'],'records':len(annotations),'sourceVerified':len(annotations),'visualAnchors':len(anchors),'semanticUnreviewed':len(annotations)-len(anchors),'independentHumanReview':False,'scoreEligible':False,'specSha256':sha(spec_path),'observationsSha256':sha(sample/'observations.jsonl'),'sourceTruthSha256':sha(sample/'evaluation-only'/'source-truth.jsonl'),'generatorSha256':sha(Path(__file__).with_name('build_activity_samples.py')),'annotatorSha256':sha(Path(__file__)),'episodes':audits,'crossLevelDiagnostic':diagnostic,'limits':['No source room polygons/mesh or original collector implementation available locally. collection_config describes cameras/modalities, not semantic room IDs.','Z plus robot_height is a cross-route alignment hypothesis suggested by consistent exterior/indoor anchors; not certified world-floor ground truth. Raw Z cannot compare different camera heights.','Do not interpolate labels between sparse anchors or infer activity/state during camera-off gaps.','No place UUID prediction, model summary or recognition output used to create annotations.']}
    (output/'audit.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('episodes','limits')}))
    return annotations,report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('sample',type=Path);p.add_argument('sources',type=Path);p.add_argument('spec',type=Path);p.add_argument('output',type=Path);a=p.parse_args();annotate(a.sample,a.sources,a.spec,a.output)

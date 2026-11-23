"""Zero-network, version-pinned IO/control-flow smoke. NEVER reports user-task accuracy.

Runs only reviewed standard-library LightMem stores in existing WSL Python; frozen
First-Sight stores/QA in a separate compiled extraction. No application patches.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

FIRST_COMMIT = '1ba4ea05df3a3378a771bb2b1625d8e34bc77734'
LIGHT_COMMIT = '3c023dfec301bb2f9624f82cee76007ac3ac0646'
ROOT = Path(__file__).resolve().parents[2]

def sha(data): return hashlib.sha256(data).hexdigest()
def write(path, data): path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
def load(path): return json.loads(path.read_text(encoding='utf8'))
def linux(path):
    value=str(Path(path).resolve()).replace('\\','/')
    if len(value)>2 and value[1]==':': return '/mnt/'+value[0].lower()+value[2:]
    return value

def light_child(source, common, output):
    # Disable network before importing upstream code; no API/embedding/model calls.
    import socket
    def denied(*args,**kwargs): raise RuntimeError('Network disabled in storage smoke')
    socket.create_connection=denied
    socket.socket.connect=denied
    socket.socket.connect_ex=denied
    sys.dont_write_bytecode=True
    sys.path.insert(0,str(source))
    from online_pipeline.frame_stream import FrameStreamStore
    from online_current.mcur_store import MCurStore
    from online_short_term.mst_store import MSTStore
    from online_short_term.schemas import mst_event_stub
    started=time.perf_counter();data=load(common)
    session=output/'session';session.mkdir(parents=True,exist_ok=False)
    stream=FrameStreamStore(session);stream.initialize(stream_id='comparison',target_fps=.5)
    current=MCurStore(session);receipts=[]
    for i,row in enumerate(data['frames']):
        raw=Path(row['pathLinux']).read_bytes()
        if sha(raw)!=row['sha256']:raise ValueError('Changed common image')
        tmp=session/f'input-{i}.png';tmp.write_bytes(raw)
        received=stream.register_frame(tmp_path=tmp,frame_index=i,checksum=row['sha256'],suffix='.png',size_bytes=len(raw),client_ts_ms=row['atMs'],relative_ts_ms=row['atMs'],source_ts_ms=row['atMs'],timestamp_source='provided_relative',width=640,height=640,source='existing-tartanground-common-input')
        state=stream.load();record=state['frames'][-1]
        current.update_from_frame_stream(frame_index=i,frame_path=str(session/record['saved_path']),relative_ts_ms=row['atMs'],client_ts_ms=row['atMs'],source='existing-tartanground-common-input')
        receipts.append({'inputId':row['id'],'atMs':row['atMs'],'memoryAccepted':record.get('memory_accepted'),'storedHash':sha((session/record['saved_path']).read_bytes())})
    # Explicit metadata-only fixture, NOT native frame-difference detection/refinement.
    event=mst_event_stub(session_id='session',chunk_id_value='io-fixture',start_time=0,end_time=4,boundary_reason='comparison-storage-fixture',diff_score=0,diff_stats={},chunk_path='')
    event['source']={'type':'adapter-defined-metadata-fixture-not-native-segmentation'}
    event['keyframes']=[{'timestamp':row['atMs']/1000,'path':r['saved_path']} for row,r in zip(data['frames'],stream.load()['frames'])]
    store=MSTStore(session);store.append_events([event])
    reopened_stream=FrameStreamStore(session).load();reopened_current=MCurStore(session).load_frames();reopened_mst=MSTStore(session).load_events()
    checks={'threeStreamFrames':len(reopened_stream['frames'])==3,'sourceTimesPreserved':[r['relative_ts_ms'] for r in reopened_stream['frames']]==[r['atMs'] for r in data['frames']], 'originalBytesPreserved':[r['storedHash'] for r in receipts]==[r['sha256'] for r in data['frames']], 'currentBufferReopened':len(reopened_current)==3, 'metadataFixtureReopened':len(reopened_mst)==1}
    if not all(checks.values()):raise AssertionError(checks)
    result={'system':'LightMem-Ego','commit':LIGHT_COMMIT,'level':'native-store-IO-only','checks':checks,'frames':receipts,'mstFixtureIsNotVisualMemory':True,'modelCalls':0,'taskAccuracy':None,'seconds':time.perf_counter()-started,'notExecuted':['native micro-event detector','caption/refine','long-term consolidation','embedding retrieval','QA generation','server/client','cross-process restoration']}
    write(output/'lightmem-smoke.json',result);print(json.dumps(result))

FIRST_JS = r'''
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const [dist,common,output]=process.argv.slice(2);
globalThis.fetch=async()=>{throw Error('Network disabled in storage smoke');};
const {RealtimeMemory}=await import(pathToFileURL(join(dist,'hardware/realtime-memory.js')));
const {answerRealtimeQuestion}=await import(pathToFileURL(join(dist,'hardware/realtime-question.js')));
const data=JSON.parse(await readFile(common,'utf8')),start=performance.now();
let memory=new RealtimeMemory(join(output,'first-sight.sqlite'));
const receipts=[];
for(const row of data.frames){
 const raw=await readFile(row.pathWindows),hash=createHash('sha256').update(raw).digest('hex');
 if(hash!==row.sha256)throw Error('Changed common image');
 memory.archive({id:row.id,atMs:row.atMs,requestWallTimeMs:row.atMs,receivedAtMs:row.atMs,jpegPath:row.pathWindows,jpegSha256:hash,pngPath:row.pathWindows,pngSha256:hash});
 receipts.push({id:row.id,atMs:row.atMs,storedHash:hash});
}
// The supplied originals are PNG; jpegPath is an unused archive-field placeholder,
// not a JPEG conversion or claim of camera ingestion validation.
const all=memory.snapshot(4000),prefix=memory.snapshot(2000);memory.close();
// Native constructor-reopen is unsupported (prior failure preserved). Use the
// release's check-realtime-history.mjs read-only SQL pattern, NOT a patched ctor.
const readonly=new DatabaseSync(join(output,'first-sight.sqlite'),{readOnly:true});
const reopened={asOfMs:4000,rows:readonly.prepare('SELECT o.raw,j.raw AS judgment,j.available_ms FROM originals o LEFT JOIN judgments j ON j.id=o.id AND j.available_ms<=? WHERE o.at_ms<=? ORDER BY o.at_ms').all(4000,4000).map(r=>({original:JSON.parse(r.raw),judgment:r.judgment?JSON.parse(r.judgment):null,availableAtMs:r.available_ms}))};readonly.close();
const requests=[];let turn=0;
const question='上次记录的画面中有什么？';
const script=[{kind:'search',query:'',cursor:0},{kind:'inspect',sourceIds:data.frames.map(f=>f.id)},{kind:'answer',text:'SCRIPTED IO/CONTROL FIXTURE, NOT A MODEL ANSWER',sourceIds:[data.frames[0].id],abstained:false}];
const answer=await answerRealtimeQuestion(all,question,async request=>{requests.push({data:request.data,imageIds:request.images.map(i=>i.id)});return script[turn++];},false);
const stale=await answerRealtimeQuestion(all,'现在眼前是什么？',async()=>{throw Error('Stopped current query must not call model');},false);
const checks={threeArchivedFrames:reopened.rows.length===3,sourceTimesPreserved:JSON.stringify(reopened.rows.map(r=>r.original.atMs))===JSON.stringify(data.frames.map(f=>f.atMs)),noFutureInPrefix:prefix.rows.length===2,readOnlyHistoryMatchesSnapshot:JSON.stringify(reopened)===JSON.stringify(all),scriptedSearchInspectAnswer:turn===3&&!answer.abstained,stoppedCurrentQueryAbstains:stale.abstained===true};
if(!Object.values(checks).every(Boolean))throw Error(JSON.stringify(checks));
const result={system:'First-Sight',commit:'1ba4ea05df3a3378a771bb2b1625d8e34bc77734',level:'native-store-plus-readonly-SQL-and-scripted-QA-control-flow-only',checks,frames:receipts,modelCalls:0,scriptedCallbackInvocations:turn,taskAccuracy:null,milliseconds:performance.now()-start,notExecuted:['producer-constructor-reopen (previously failed, not patched)','place producer','actual model search/inspect/answer','object-state tracking','route explanation','hardware/server','cross-process restoration']};
await writeFile(join(output,'first-sight-smoke.json'),JSON.stringify(result,null,2));
await writeFile(join(output,'first-sight-scripted-trace.json'),JSON.stringify({question,script,requests,answer,stale},null,2));
console.log(JSON.stringify(result));
'''

def run(root, light_repo, attempt):
    if not (root/'preflight.md').is_file(): raise ValueError('Run/no-run preflight required before upstream execution')
    task=load(root/'task.json')
    from datetime import datetime,timezone
    if datetime.now(timezone.utc)>=datetime.fromisoformat(task['deadlineUTC']):raise TimeoutError('Three-day timebox exhausted')
    if not attempt.startswith('storage-smoke') or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in attempt):raise ValueError('Invalid attempt name')
    output=root/attempt;output.mkdir(exist_ok=False)
    isolated=Path(os.environ['LOCALAPPDATA'])/'Temp/opencode'/f'lightmem-first-sight-{root.name}-{attempt}'
    isolated.mkdir(parents=True,exist_ok=False)
    lm=isolated/'lightmem';fs=isolated/'first-sight';lm.mkdir();fs.mkdir()
    sources=[]
    def extract(repo,commit,paths,target,prefix=''):
        for path in paths:
            content=subprocess.check_output(['git','show',f'{commit}:{path}'],cwd=repo,timeout=15)
            dest=target/(path[len(prefix):] if prefix else path);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(content)
            sources.append({'commit':commit,'originalPath':path,'extractedPath':str(dest),'sha256':sha(content),'patched':False})
    light_paths=['online_pipeline/__init__.py','online_pipeline/frame_stream.py','online_preprocess/__init__.py','online_preprocess/io_utils.py','online_current/__init__.py','online_current/schemas.py','online_current/mcur_store.py','online_short_term/__init__.py','online_short_term/schemas.py','online_short_term/mst_store.py']
    # One bounded source-closure correction after reviewing eager package imports.
    # No upstream file is rewritten and the detector is NOT instantiated.
    light_paths += ['online_current/mcur_updater.py','online_current/mcur_selector.py','online_short_term/mst_retriever.py','online_short_term/frame_diff_detector.py','online_short_term/stream_chunk_manager.py','online_short_term/transcript_aligner.py']
    extract(light_repo,LIGHT_COMMIT,['src/backend/'+p for p in light_paths],lm,prefix='src/backend/')
    extract(ROOT,FIRST_COMMIT,['src/hardware/realtime-memory.ts','src/hardware/realtime-question.ts','src/agent/spatial-json-vlm.ts','src/agent/bounded-network-retry.ts','scripts/testing/check-realtime-history.mjs'],fs)
    write(fs/'package.json',{'type':'module'})
    manifest=load(ROOT/'run/replicacad-pilot/tartanground-moderncity-p0006-v1/public/manifest.json')
    all_rows=[json.loads(l) for l in (ROOT/'run/replicacad-pilot/tartanground-moderncity-p0006-v1/public/observations.jsonl').read_text().splitlines()]
    frames=[]
    for i in [0,20,40]:
        row=all_rows[i];frame=next(v for v in row['frames'] if v['view']=='front');path=(ROOT/'run/replicacad-pilot/tartanground-moderncity-p0006-v1/public'/frame['path']).resolve()
        if sha(path.read_bytes())!=frame['sha256']:raise ValueError('Common original changed')
        frames.append({'id':f'common-{i//20}','atMs':row['sourceAtMs'],'sha256':frame['sha256'],'pathWindows':str(path),'pathLinux':linux(path)})
    common={'schema':'comparison-common-IO-frames-v1','scope':'3 unchanged Tartan front originals at 0/2/4s; no user-task questions, poses, audio or captions','frames':frames,'source':'TartanGround CC-BY-4.0','firstSightInputAdapter':'direct archive/prepared-PNG fields, not camera JPEG validation','lightInputAdapter':'native frame store and M_cur, manual provisional metadata event only'}
    write(output/'common-input.json',common)
    write(output/'source-extraction.json',{'sources':sources,'isolatedRoot':str(isolated),'commonSha256':sha((output/'common-input.json').read_bytes())})
    write(output/'initializer-review.json',{'review':'Reviewed pinned __init__ files: online_pipeline docstring; online_preprocess typing/__all__/lazy __getattr__; online_current imports stores/updater/selector; online_short_term imports store/retriever. Dependencies extracted unchanged. Detector/ASR/subprocess/model constructors not called.','initializers':[{'path':str(p),'sha256':sha(p.read_bytes())} for p in lm.rglob('__init__.py')],'priorAttempt':'storage-smoke/stopped.json: conservative harness gate stopped BEFORE upstream execution; preserved, not a system task failure.'})
    commands=[]
    def execute(name,args):
        started=time.perf_counter()
        proc=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120)
        (output/f'{name}.stdout.txt').write_text(proc.stdout,encoding='utf8');(output/f'{name}.stderr.txt').write_text(proc.stderr,encoding='utf8')
        commands.append({'name':name,'args':args,'returncode':proc.returncode,'elapsedSeconds':time.perf_counter()-started})
        write(output/'commands.json',commands)
        if proc.returncode:raise RuntimeError(f'{name} failed; one bounded attempt, see logs; no automatic dependency install')
    execute('first-sight-compile',['node',str(ROOT/'node_modules/typescript/bin/tsc'),'--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots',str(ROOT/'node_modules/@types'),'--strict','--skipLibCheck','--outDir',str(fs/'dist'),str(fs/'src/hardware/realtime-memory.ts'),str(fs/'src/hardware/realtime-question.ts')])
    script=output/'first-sight-smoke.mjs';script.write_text(FIRST_JS,encoding='utf8')
    execute('first-sight-native-store-scripted-QA',['node',str(script.resolve()),str(fs/'dist'),str((output/'common-input.json').resolve()),str(output.resolve())])
    execute('lightmem-native-stores',['wsl.exe','-d','Ubuntu','--','python3',linux(Path(__file__)), '--lightmem-child',linux(lm),linux(output/'common-input.json'),linux(output)])
    fs_result=load(output/'first-sight-smoke.json');lm_result=load(output/'lightmem-smoke.json')
    result={'status':'local-store-smoke-completed-not-task-evaluation','sameOriginalHashes':[r['storedHash'] for r in fs_result['frames']]==[r['storedHash'] for r in lm_result['frames']], 'firstSight':fs_result,'lightMem':lm_result,'paidCalls':0,'taskAccuracy':None,'scope':'Different native stores, same raw input. Not identical full pipelines or a budget-normalized user task comparison.'}
    write(output/'summary.json',result);print(json.dumps({'status':result['status'],'sameOriginalHashes':result['sameOriginalHashes'],'paidCalls':0,'taskAccuracy':None}))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--lightmem-child':
        light_child(Path(sys.argv[2]),Path(sys.argv[3]),Path(sys.argv[4]))
    else:
        p=argparse.ArgumentParser(description=__doc__);p.add_argument('run_root',type=Path);p.add_argument('--attempt',default='storage-smoke');p.add_argument('--lightmem-repo',type=Path,default=Path(r'C:\Users\helele\AppData\Local\Temp\opencode\lightmem-ego-audit'))
        a=p.parse_args()
        try:run(a.run_root.resolve(),a.lightmem_repo,a.attempt)
        except Exception as error:
            target=a.run_root/a.attempt;target.mkdir(parents=True,exist_ok=True);write(target/'stopped.json',{'error':str(error),'automaticRetry':False,'taskAccuracy':None});raise

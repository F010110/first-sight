import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createSpatialMemoryReviewServer} from './spatial-memory-review-server.js';

const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const annotation=(placeId:string)=>({segmentId:'s1',placeId,facilityId:placeId,description:placeId,visibility:'clear',boundaryUncertain:false});

test('review server binds one run, serves judgement/reference/image and only appends human reviews',async()=>{
 const root=await mkdtemp(join(tmpdir(),'memory-review-'));
 try{
  const run=join(root,'run'),judge=join(root,'judge');await mkdir(join(run,'originals'),{recursive:true});await mkdir(judge);
  const db=Buffer.from('sqlite-placeholder'),png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),viewSha=sha(png);
  await writeFile(join(run,'spatial.sqlite'),db);await writeFile(join(run,'originals',viewSha+'.png'),png);
  const sample={frames:['o1','o2'].map((id,i)=>({id,atMs:i*2000,sourceAtMs:i*2000,annotation:annotation('a')})),segments:[{id:'s1',startIndex:0,endIndex:1,startMs:0,endMs:2000,placeId:'a',title:'A',kind:'test'}]};
  const referenceBytes=JSON.stringify(sample);
  const bundle={schema:'holistic-memory-audit-bundle-v1',run,hashes:{database:sha(db),reference:sha(referenceBytes)},
   observations:['o1','o2'].map((id,i)=>({id,atMs:i*2000,views:[{direction:'front',path:join(run,'originals',viewSha+'.png'),sha256:viewSha}],facts:{summary:'f'+i}})),
   states:[{version:1,atMs:2000,memberIds:['o1','o2'],window:{startMs:0,endExclusiveMs:4000,observations:[{id:'o1'},{id:'o2'}]},assessment:{location:{status:'known',placeId:'p1',name:'A',reason:'r'}},locationDecision:'new',visitId:'v1'}],
   claims:[],places:[{id:'p1',name:'A',created_version:1}],visits:[{id:'v1',place_id:'p1',start_version:1}],revisions:[],
   reference:['o1','o2'].map(id=>({id,annotation:annotation('a')})),integrity:{},scope:{coverage:{skippedWindows:0,fullCoverage:true}}};
  await writeFile(join(judge,'bundle.json'),JSON.stringify(bundle));
  await writeFile(join(judge,'report.json'),JSON.stringify({completed:true,model:'test',scores:{overall:100,dimensions:{location:4,identity:4,organization:4,evidence:4,uncertainty:4}},coverage:{},coverageScope:'full',gate:{fullCoverage:true},findings:[]}));
  await writeFile(join(judge,'comparison-000.json'),JSON.stringify({windows:[{version:1,identity:{verdict:'supported',reason:'ok'},currentReason:{verdict:'supported',reason:'ok'},windowScope:{verdict:'supported',reason:'ok'}}]}));
  await writeFile(join(run,'complete.json'),JSON.stringify({completed:true,observations:2,spatialStates:1,skippedWindows:0,skippedObservations:0,coveredObservations:2,windowMs:8000,realtimeEnforced:true}));
  await writeFile(join(root,'reference.json'),referenceBytes);
  const server=await createSpatialMemoryReviewServer({run,judge,reference:join(root,'reference.json'),webRoot:resolve('web/memory-review')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));
  const port=(server.address() as any).port as number,base=`http://127.0.0.1:${port}`;
  const get=async(path:string)=>{const r=await fetch(base+path);const buffer=Buffer.from(await r.arrayBuffer());return {status:r.status,json:r.headers.get('content-type')?.includes('json')?JSON.parse(buffer.toString()):null,buffer};};
  try{
   assert.equal((await get('/')).status,200);
   const overview=await get('/api/overview');assert.equal(overview.status,200);assert.equal(overview.json.groups.length,1);assert.equal(overview.json.windows.length,1);assert.equal(overview.json.skipped.length,0);
   const group=await get('/api/group/s1');assert.equal(group.json.group.identityScore,100);assert.equal(group.json.windows.length,1);
   const window=await get('/api/window/1');assert.equal(window.json.observations.length,2);assert.equal(window.json.comparison.identity.verdict,'supported');
   const image=await get('/original/o1/front');assert.equal(image.status,200);assert.equal(sha(image.buffer),viewSha);
   assert.equal((await get('/api/window/999')).status,404);
   const auth=await fetch(base+'/api/review',{method:'POST',headers:{'content-type':'application/json','origin':base,'x-review-token':overview.json.reviewToken},body:JSON.stringify({targetType:'group',targetId:'s1',verdict:'agree',note:'ok'})});
   assert.equal(auth.status,200);assert.equal((await auth.json()).reviews.length,1);
   const noToken=await fetch(base+'/api/review',{method:'POST',headers:{'content-type':'application/json','origin':base},body:JSON.stringify({targetType:'group',targetId:'s1',verdict:'agree',note:''})});
   assert.equal(noToken.status,403);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 }finally{await rm(root,{recursive:true,force:true});}
});

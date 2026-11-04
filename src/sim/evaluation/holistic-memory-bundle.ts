import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import type {SpatialJsonImage} from '../../agent/spatial-json-vlm.js';
import type {JudgeClaim} from './holistic-memory-contract.js';

export const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export type AuditObservation={id:string;atMs:number;sourceAtMs?:number;views:SpatialJsonImage[];facts:unknown};
export type AuditBundle={schema:string;run:string;hashes:Record<string,string>;complete:any;observations:AuditObservation[];states:any[];claims:JudgeClaim[];places:any[];visits:any[];revisions:any[];reference:any[];integrity:any;scope:any};
/** The final receipt may be a recovery receipt; a failed complete.json is never treated as success. */
export async function readRunReceipt(run:string){
 const direct=join(run,'complete.json');
 const files=(await readdir(run)).filter(n=>/^complete(-recovery-[^/]+)?\.json$/.test(n)).sort();
 const candidates=[direct,...files.map(n=>join(run,n))];
 for(const path of [...candidates.filter(p=>p!==direct).reverse(),direct]){
  try{const bytes=await readFile(path),value=JSON.parse(bytes.toString());if(value?.completed===true)return {path,bytes,value};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 throw Error('Require a completed run receipt; no failed complete.json is accepted as success');
}
/** No producer/store imports: SQLite is query-only, labels join on exact ID and source clock/hash. */
export async function prepareHolisticBundle(runArg:string,referencePath:string,outArg:string):Promise<AuditBundle>{
 const run=resolve(runArg),out=resolve(outArg),dbPath=join(run,'spatial.sqlite');
 const before=sha(await readFile(dbPath)),referenceBytes=await readFile(referencePath),sample=JSON.parse(referenceBytes.toString());
 const publicBytes=await readFile(join(resolve(referencePath,'..'),'public-source.json')),publicInput=JSON.parse(publicBytes.toString());
 const receipt=await readRunReceipt(run),complete=receipt.value,completeBytes=receipt.bytes;
 if(!complete.completed||complete.inputSHA256!==sha(publicBytes)||sample.reviewRequired!==false)throw Error('Require complete memory bound to reviewed public source');
 const db=new DatabaseSync(dbPath,{readOnly:true});let bundle:AuditBundle;
 try{
  db.exec('BEGIN');if(db.prepare('SELECT version FROM spatial_schema').get()?.version!==4)throw Error('Expected schema-v4');
  const rows=db.prepare('SELECT id,raw,facts FROM observations ORDER BY seq').all() as any[];
  const observations:AuditObservation[]=rows.map(r=>({...JSON.parse(r.raw),facts:r.facts?JSON.parse(r.facts):null}));
  const states=db.prepare('SELECT raw FROM states ORDER BY version').all().map(r=>{const s=JSON.parse(r.raw as string);return {...s,memberIds:s.window?.observations.map((o:any)=>o.id)??[s.observationId]};});
  const covered=(db.prepare('SELECT observation_id FROM window_members').all() as any[]).map(r=>r.observation_id);
  const counts=Object.fromEntries(['checkpoints','checkpoint_bindings','revisions','skipped_windows'].map(t=>[t,db.prepare('SELECT count(*) AS n FROM '+t).get()!.n]));
  if(observations.length!==complete.planned||observations.length!==complete.coveredObservations||states.length!==complete.plannedStates||counts.checkpoints!==states.length||counts.checkpoint_bindings!==states.length||covered.length!==observations.length||counts.skipped_windows!==0||observations.some(o=>!o.facts)||new Set(covered).size!==observations.length||observations.some(o=>!covered.includes(o.id)))throw Error('Incomplete observation/window/checkpoint coverage');
  const reference=[];
  for(const [i,o] of observations.entries()){
   const source=publicInput.observations[i],f=sample.frames.find((f:any)=>f.id===o.id);
   if(!source||source.id!==o.id||!f||f.annotation?.status!=='annotation-complete'||f.sourceAtMs!==(o.sourceAtMs??source.sourceAtMs??source.atMs)||f.sourceAtMs!==(source.sourceAtMs??source.atMs)||o.views.length!==3||new Set(o.views.map(v=>v.direction)).size!==3)throw Error('Reference/input source-clock mismatch: '+o.id);
   for(const v of o.views){if(source.views.find((x:any)=>x.direction===v.direction)?.sha256!==v.sha256||sha(await readFile(v.path))!==v.sha256)throw Error('Original/public reference hash mismatch');}
   const a=f.annotation;
   reference.push({id:o.id,sourceAtMs:f.sourceAtMs,annotation:{segmentId:a.segmentId,placeId:a.placeId,facilityId:a.facilityId,description:a.description,visibility:a.visibility,boundaryUncertain:a.boundaryUncertain}});
  }
  const places=db.prepare('SELECT * FROM places ORDER BY created_version').all(),visits=db.prepare('SELECT * FROM visits ORDER BY start_version').all();
  const notes=(db.prepare('SELECT * FROM place_notes ORDER BY created_version,id').all() as Array<{id:string;place_id:string;text:string;created_version:number}>).map(n=>({...n,sources:db.prepare('SELECT version,source_id FROM place_note_sources WHERE note_id=? ORDER BY version').all(n.id)}));
  const revisions=db.prepare('SELECT place_id,version,key,raw FROM place_profile_revisions ORDER BY version').all().map(r=>({...r,raw:JSON.parse(r.raw as string)}));
  const claims:JudgeClaim[]=[...states.map(s=>({id:'state:'+s.version,value:{version:s.version,observationId:s.observationId,memberIds:s.memberIds,assessment:s.assessment,locationDecision:s.locationDecision,visitId:s.visitId,memoryReceipt:s.memoryReceipt}})),...notes.map(n=>({id:'note:'+n.id,value:n})),...revisions.map((r,i)=>({id:'revision:'+i,value:r}))];
  bundle={schema:'holistic-memory-audit-bundle-v1',run,hashes:{database:before,reference:sha(referenceBytes),publicInput:sha(publicBytes),complete:sha(completeBytes)},complete,observations,states,claims,places,visits,revisions,reference,integrity:{passed:true,observations:observations.length,states:states.length,sourceImages:observations.length*3,...counts},scope:{referenceAuthority:sample.provenance,referenceLimitations:sample.limitations,referenceIsEvaluationOnly:true,stationInteriorSinglePlaceAccepted:true,ocrAndObjectClassificationDeferred:true,notTesting:['QA','executed long-term retrieval','navigation safety']}};
  db.exec('COMMIT');
 }finally{db.close();}
 if(sha(await readFile(dbPath))!==before)throw Error('Database changed during read-only packaging');
 await mkdir(out,{recursive:false});await writeFile(join(out,'bundle.json'),JSON.stringify(bundle,null,2),{flag:'wx'});
 return bundle;
}

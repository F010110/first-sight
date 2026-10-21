import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CampusSource} from '../assistant/campus-source.js';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';
import {SpatialContextLoop} from '../agent/spatial-context-loop.js';
import {spatialContextVlm} from '../agent/spatial-context-vlm.js';
import {reviewedSpatialModel,spatialReferenceIds} from '../agent/spatial-context-identity-review.js';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

if(!process.argv.includes('--confirm-paid'))throw Error('Require --confirm-paid; maximum estimated USD0.60 across two isolated arms');
const root=resolve('run/spatial-identity-experiment',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
await mkdir(root,{recursive:true});console.log(root);
const source=await CampusSource.load('run/inspect-repair-full90-v1/model-replay/observations.jsonl');
const spans=[{episode:1,start:0,end:134000},{episode:4,start:88000,end:150000}];
const selected:Array<{index:number;observation:SpatialObservation}>=[];
for(const span of spans)for(let seconds=span.start;seconds<=span.end;seconds+=2000){
 const index=source.indexAt(span.episode,seconds),row=await source.read(index);
 if(row.sourceAtMs!==seconds)throw Error('Selected source time not exact');
 selected.push({index,observation:{id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:`campus-episode-${row.episodeNumber}`,frames:row.views.map(v=>v.path)}});
}
// Private, pre-run manual development checks. Never supplied to either model.
const id=(ep:number,seconds:number)=>selected.find(r=>r.observation.recordingId===`campus-episode-${ep}`&&r.observation.sourceAtMs===seconds*1000)!.observation.id;
const checks=[
 {a:id(1,48),b:id(1,80),relation:'different',basis:'Court markings/hoop inside fence versus tree-side ground outside fence; three views reviewed.'},
 {a:id(1,80),b:id(1,112),relation:'different',basis:'Tree-side ground versus marked fenced court; limited manual development judgment.'},
 {a:id(1,48),b:id(1,112),relation:'same',basis:'Same marked court with fence/building/hoop arrangement; development judgment, not independent GT.'},
 ...[[112,120],[120,128],[112,128]].map(([a,b])=>({a:id(4,a!),b:id(4,b!),relation:'review-required',basis:'Connected indoor circulation with turns/doorways; region granularity not independently established. Inspect new/reused identities and original comparisons; exclude from correctness count.'}))
];
await writeFile(join(root,'private-checks.json'),JSON.stringify({checks,note:'Frozen development-only checks, not full boundary annotation or independent acceptance; never model input.'},null,2));
const files=['src/desktop/experiment-spatial-identity.ts','src/agent/spatial-context-identity-review.ts','src/agent/spatial-context-loop.ts','src/agent/spatial-context-memory.ts','src/agent/spatial-context-vlm.ts','src/agent/spatial-working-context.ts'];
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const originals=['run/inspect-repair-full90-v1/memory.sqlite','run/campus-spatial-memory/2026-10-20T13-42-03-856Z-ecad0254/memory.sqlite'];
const originalHashes=Object.fromEntries(await Promise.all(originals.map(async p=>[p,await hash(p)])));
await writeFile(join(root,'frozen.json'),JSON.stringify({schema:'spatial-identity-experiment-v1',model:'qwen3.8-flash',enableThinking:false,temperature:0,spans,observations:selected.map(r=>({index:r.index,...r.observation})),sourceManifestSha256:source.manifestSha256,privateChecksSha256:await hash(join(root,'private-checks.json')),sourceHashes:Object.fromEntries(await Promise.all(files.map(async p=>[p,await hash(p)]))),originalHashes,arms:['control','review'],maxCallsPerArm:96,maxEstimatedUSDPerArm:.30,maxOutputTokens:2400,maxReviewAttempts:3,note:'Matched cropped replay from empty memory, not a complete episode/whole-campus accuracy claim. Control has identical windows/output cap, but no automatic historical references or comparison policy.'},null,2));
const results:unknown[]=[];
for(const arm of ['control','review']){
 const path=join(root,arm);await mkdir(path);
 const memory=new SpatialContextMemory(join(path,'memory.sqlite'));
 const base=spatialContextVlm(join(path,'requests'),96,.30,async(atMs,value)=>memory.writeOutput(atMs,value),undefined,2400);
 const model=arm==='review'?reviewedSpatialModel(base,async value=>{await appendFile(join(path,'review-events.jsonl'),JSON.stringify(value)+'\n');}):base;
 const lookup=new Map(selected.map(row=>[row.observation.id,row.observation]));
 const loop=new SpatialContextLoop(memory,model,4,arm==='review'?(context,observations)=>spatialReferenceIds(context,observations).filter(id=>lookup.get(id)?.recordingId===observations[0]!.recordingId):undefined);
 let completed=0,error:string|null=null;
 try{
  for(let index=0;index<selected.length;){
   const batch=selected.slice(index,index+4).filter(r=>r.observation.recordingId===selected[index]!.observation.recordingId);
   const result=await loop.runWindow(batch.map(row=>row.observation));
   if(result.status!=='observed')throw Error(`Window did not finish: ${JSON.stringify(result)}`);
   completed+=batch.length;index+=batch.length;
   await appendFile(join(path,'contexts.jsonl'),JSON.stringify({availableAtMs:batch.at(-1)!.observation.atMs,context:loop.context.view()})+'\n');
   await writeFile(join(path,'progress.json'),JSON.stringify({completed,total:selected.length}));
  }
 }catch(e){error=String(e);await writeFile(join(path,'stopped.json'),JSON.stringify({error,completed}));}
 finally{memory.close();}
 const db=new DatabaseSync(join(path,'memory.sqlite'),{readOnly:true});
 const assignment=(id:string)=>(db.prepare('SELECT place_id FROM assignments WHERE observation_id=?').get(id) as {place_id:string|null}|undefined)?.place_id??null;
 const pairs=checks.map(check=>{const a=assignment(check.a),b=assignment(check.b);return {...check,aPlace:a,bPlace:b,status:check.relation==='review-required'?'review-required':a===null||b===null?'unknown':((a===b)===(check.relation==='same')?'correct':'wrong')};});
 const counts=db.prepare('SELECT count(*) AS observations,count(distinct place_id) AS places,sum(place_id IS NULL) AS unknown FROM assignments').get();db.close();
 const result={arm,completed,total:selected.length,error,counts,pairs,usage:JSON.parse(await readFile(join(path,'requests/usage.json'),'utf8'))};
 results.push(result);await writeFile(join(path,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
const afterHashes=Object.fromEntries(await Promise.all(originals.map(async p=>[p,await hash(p)])));
await writeFile(join(root,'report.json'),JSON.stringify({results,originalsUnchanged:JSON.stringify(originalHashes)===JSON.stringify(afterHashes),afterHashes,note:'One paired exploratory run; no independent semantic grading, full-region annotation or real-time claim. No previous answers or identities reused.'},null,2));

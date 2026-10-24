import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CampusSource} from '../../assistant/campus-source.js';
import {SpatialContextMemory} from '../../agent/spatial-context-memory.js';
import {SpatialContextLoop} from '../../agent/spatial-context-loop.js';
import {spatialContextVlm} from '../../agent/spatial-context-vlm.js';
import {SeparatedSpatialAgent} from '../../agent/spatial-separated-agent.js';
import {spatialJsonVlm,type SpatialJsonImage} from '../../agent/spatial-json-vlm.js';
import {independentPerceptionPrompt,explicitIdentityPrompt} from '../../agent/spatial-separated-protocol.js';
import type {SpatialObservation} from '../../agent/incremental-spatial-memory.js';

if(!process.argv.includes('--confirm-paid'))throw Error('Require --confirm-paid; two isolated arms, total estimated budget USD0.60');
const root=resolve('run/spatial-separated-experiment',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});console.log(root);
const manifest='run/inspect-repair-full90-v1/model-replay/observations.jsonl',source=await CampusSource.load(manifest);
const publicRows=(await readFile(manifest,'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
const indexById=new Map<string,number>(publicRows.map((r,index)=>[r.id,index]));
const selected:SpatialObservation[]=[];
for(let ms=0;ms<=62000;ms+=2000){const row=await source.read(source.indexAt(6,ms));if(row.sourceAtMs!==ms)throw Error('Nonexact experiment source time');selected.push({id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:'campus-episode-6',frames:row.views.map(v=>v.path)});}
const id=(seconds:number)=>selected.find(o=>o.sourceAtMs===seconds*1000)!.id;
const checks=[{a:id(16),b:id(48),relation:'same',basis:'Inside marked court, consistent fence/building/hoop layout; all three views inspected.'},{a:id(16),b:id(62),relation:'different',basis:'Inside court versus stone path outside fence, checked with simultaneous side views.'},{a:id(48),b:id(62),relation:'different',basis:'Court interior versus wall/fence path outside; development-only pair, not independent GT.'}];
await writeFile(join(root,'private-checks.json'),JSON.stringify({checks,note:'Never supplied to models. Three dependent manual development checks, not a full-region acceptance score.'},null,2));
const hash=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex');
const originals=['run/inspect-repair-full90-v1/memory.sqlite','run/campus-spatial-memory/2026-10-20T13-42-03-856Z-ecad0254/memory.sqlite'];
const originalHashes=Object.fromEntries(await Promise.all(originals.map(async p=>[p,await hash(p)])));
const files=['src/sim/evaluation/experiment-separated-spatial.ts','src/agent/spatial-separated-protocol.ts','src/agent/spatial-separated-agent.ts','src/agent/spatial-json-vlm.ts','src/agent/spatial-context-loop.ts','src/agent/spatial-context-memory.ts','src/agent/spatial-context-vlm.ts'];
await writeFile(join(root,'frozen.json'),JSON.stringify({schema:'separated-spatial-experiment-v2',sourceManifestSha256:source.manifestSha256,observations:selected,sourceHashes:Object.fromEntries(await Promise.all(files.map(async p=>[p,await hash(p)]))),originalHashes,privateChecksSha256:await hash(join(root,'private-checks.json')),model:'qwen3.8-flash',enableThinking:false,temperature:0,budgets:{control:{maxCalls:48,maxEstimatedUSD:.2},separated:{maxCalls:96,maxEstimatedUSD:.4}},schedule:'Both arms one source observation at a time, same 32 observations at 0.5fps. Control one unified judgment; separated independent current perception then explicit identity action with retrieved originals.',scope:'Episode 6 first 62s, not used in earlier episode1/4 tuning; startup six seconds now development-reviewed after v1 stopped. Not independent held-out dataset or full-episode/real-time acceptance.'},null,2));
const imagesFor=async(ids:string[],currentId:string,atMs:number):Promise<SpatialJsonImage[]>=>{
 const images:SpatialJsonImage[]=[];
 for(const id of ids){const index=indexById.get(id);if(index===undefined)throw Error('Unknown image ID');const row=await source.read(index);if(row.atMs>atMs||id!==currentId&&row.atMs>=atMs)throw Error('Future reference blocked');for(const view of row.views)images.push({id,direction:view.direction,path:view.path,sha256:view.sha256});}
 return images;
};
const results:unknown[]=[];
for(const arm of ['control','separated']){
 const path=join(root,arm);await mkdir(path);const memory=new SpatialContextMemory(join(path,'memory.sqlite'));
 const control=arm==='control'?new SpatialContextLoop(memory,spatialContextVlm(join(path,'requests'),48,.2,async(atMs,v)=>memory.writeOutput(atMs,v)),2):null;
 const request=spatialJsonVlm(join(path,'requests'),96,.4);
 const agent=arm==='separated'?new SeparatedSpatialAgent(memory,{
  perceive:async input=>request({phase:'perception',prompt:independentPerceptionPrompt,data:input,images:await imagesFor([input.current.id],input.current.id,input.current.atMs)}),
  identify:async input=>request({phase:'identity',prompt:explicitIdentityPrompt,data:input,images:await imagesFor([input.current.id,...input.references.map(r=>r.id)],input.current.id,input.current.atMs)})
 }):null;
 let completed=0,error:string|null=null;
 try{
  for(const observation of selected){
   const result=agent?await agent.observe(observation):await control!.run(observation);
   if(control&&(result as any).status!=='observed')throw Error('Control did not complete observation');
   await appendFile(join(path,'events.jsonl'),JSON.stringify({atMs:observation.atMs,result})+'\n');completed++;
   await writeFile(join(path,'progress.json'),JSON.stringify({completed,total:selected.length}));
  }
 }catch(e){error=String(e);await writeFile(join(path,'stopped.json'),JSON.stringify({error,completed}));}
 finally{memory.close();}
 const db=new DatabaseSync(join(path,'memory.sqlite'),{readOnly:true});
 const assignment=(id:string)=>(db.prepare('SELECT place_id FROM assignments WHERE observation_id=?').get(id) as {place_id:string|null}|undefined)?.place_id??null;
 const pairs=checks.map(check=>{const a=assignment(check.a),b=assignment(check.b);return {...check,aPlace:a,bPlace:b,status:a===null||b===null?'unknown':((a===b)===(check.relation==='same')?'correct':'wrong')};});
 const counts={...db.prepare('SELECT count(*) AS observations,count(distinct place_id) AS places,sum(place_id IS NULL) AS unknown FROM assignments').get(),...db.prepare('SELECT count(*) AS storedObservations,sum(pending=1) AS pending FROM observations').get()};db.close();
 let usage:unknown=null;try{usage=JSON.parse(await readFile(join(path,'requests/usage.json'),'utf8'));}catch{}
 const result={arm,completed,total:selected.length,error,counts,pairs,usage};results.push(result);await writeFile(join(path,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
const afterHashes=Object.fromEntries(await Promise.all(originals.map(async p=>[p,await hash(p)])));
await writeFile(join(root,'report.json'),JSON.stringify({results,originalsUnchanged:JSON.stringify(originalHashes)===JSON.stringify(afterHashes),afterHashes,note:'Exploratory development pair; no independent human semantic grading or full boundary labels. No automatic production replacement.'},null,2));

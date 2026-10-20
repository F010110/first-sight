import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CampusSource} from '../assistant/campus-source.js';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';
import {SpatialContextLoop} from '../agent/spatial-context-loop.js';
import {spatialContextVlm} from '../agent/spatial-context-vlm.js';
import type {PreparedObservation} from '../assistant/prepared-memory.js';

if(!process.argv.includes('--confirm-paid'))throw Error('Require --confirm-paid for the independent spatial producer');
const root=resolve('run/campus-spatial-memory',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});
const source=await CampusSource.load('run/inspect-repair-full90-v1/model-replay/observations.jsonl');
const memory=new SpatialContextMemory(join(root,'memory.sqlite'));
const model=spatialContextVlm(join(root,'requests'),512,1,async(atMs,value)=>{await memory.writeOutput(atMs,value);});
const loop=new SpatialContextLoop(memory,model,16),rows:PreparedObservation[]=[];
await writeFile(join(root,'frozen.json'),JSON.stringify({schema:'spatial-producer-v1',sourceManifestSha256:source.manifestSha256,observations:source.length,questions:0,maxCalls:512,maxEstimatedUSD:1,model:'qwen3.8-flash',enableThinking:false,sourceHashes:Object.fromEntries(await Promise.all(['src/desktop/prepare-campus-memory.ts','src/agent/spatial-context-loop.ts','src/agent/spatial-context-vlm.ts','src/agent/spatial-context-memory.ts'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')]))),availability:'Context becomes available at the last observation of each <=4-frame window, synthetic source schedule; not a real-time latency claim.'},null,2));
console.log(root);
let batch:PreparedObservation[]=[],episode=-1,failure:unknown;
const flush=async()=>{
 if(!batch.length)return;
 const availableAtMs=batch.at(-1)!.observation.atMs;
 const result=await loop.runWindow(batch.map(row=>row.observation),null);
 if(result.status!=='observed')throw Error('Spatial producer did not complete observation window');
 for(const row of batch){row.availableAtMs=availableAtMs;rows.push(row);}
 await appendFile(join(root,'contexts.jsonl'),JSON.stringify({availableAtMs,observationIds:batch.map(row=>row.observation.id),context:loop.context.view()})+'\n');
 batch=[];await writeFile(join(root,'progress.json'),JSON.stringify({observations:rows.length,total:source.length,questions:0}));
};
try{
 for(let index=0;index<source.length;index++){
  const row=await source.read(index);
  if(row.episodeNumber!==episode){await flush();episode=row.episodeNumber;}
  batch.push({observation:{id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:`campus-episode-${row.episodeNumber}`,frames:row.views.map(view=>view.path)},sha256:row.views.map(view=>view.sha256),availableAtMs:Infinity});
  if(batch.length===4)await flush();
 }
 await flush();
}catch(error){failure=String(error);await writeFile(join(root,'stopped.json'),JSON.stringify({error:failure,completedObservations:rows.length,questions:0}));}
finally{memory.close();await writeFile(join(root,'observations.json'),JSON.stringify(rows));}
if(failure)throw Error(String(failure));
const hashes=Object.fromEntries(await Promise.all(['memory.sqlite','observations.json','contexts.jsonl'].map(async name=>[name,createHash('sha256').update(await readFile(join(root,name))).digest('hex')])));
await writeFile(join(root,'complete.json'),JSON.stringify({schema:'prepared-spatial-memory-v1',observations:rows.length,sourceManifestSha256:source.manifestSha256,hashes,questions:0,mode:'spatial-only',note:'Read-only consumer; never expose snapshots from after the query cutoff.'},null,2));
console.log(JSON.stringify({root,observations:rows.length,questions:0}));

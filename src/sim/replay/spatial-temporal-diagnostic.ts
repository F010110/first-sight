/** Fixed-context two-arm visual-overlap diagnostic; no database mutation or truth input. */
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spatialV2Vlm} from '../../agent/spatial-v2-vlm.js';
import type {SpatialObservation} from '../../agent/incremental-spatial-memory.js';
const [input,dataset,output,paid]=process.argv.slice(2);
if(!input||!dataset||!output||paid!=='--confirm-paid')throw Error('Usage: frozen-input.json dataset NEW-output --confirm-paid');
const fixed=JSON.parse(await readFile(input,'utf8'));
if(!fixed.reviewProposal||fixed.batch.length>4)throw Error('Bounded prior review input required');
const rows=(await readFile(join(dataset,'observations.jsonl'),'utf8')).trim().split(/\r?\n/).map(l=>JSON.parse(l));
if(rows.length>90)throw Error('Diagnostic input max90 observations');
const before=Math.min(...fixed.batch.map((b:SpatialObservation)=>b.atMs));const recording=fixed.batch[0].recordingId;
const committed=new Set(fixed.history.assignments.map((a:{observationId:string})=>a.observationId));
const prior=rows.filter(r=>committed.has(r.id)&&r.sessionId===recording&&r.atMs<before).slice(-2).map(r=>({id:r.id,recordingId:r.sessionId,atMs:r.atMs,frames:['front','left','right'].map(v=>resolve(dataset,r.cameras[v]))}));
await mkdir(output,{recursive:false});const results=[];
for(const [arm,observations] of [['without-overlap',[]],['with-overlap',prior]] as const){
 const root=join(output,arm);const history={...fixed.history,observations};
 const answer=await spatialV2Vlm(root,fixed.reviewProposal)(fixed.batch,history);let calls=0,inputTokens=0,outputTokens=0;
 for(const dir of await readdir(root))for(const file of await readdir(join(root,dir)))if(/^response-\d+\.json$/.test(file)){const raw=JSON.parse(await readFile(join(root,dir,file),'utf8'));const u=raw.response.usage;if(!Number.isFinite(u?.prompt_tokens)||!Number.isFinite(u?.completion_tokens))throw Error('Usage missing: stop diagnostic');calls++;inputTokens+=u.prompt_tokens;outputTokens+=u.completion_tokens;}
 results.push({arm,priorIds:observations.map(o=>o.id),answer,calls,inputTokens,outputTokens});await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
}
await writeFile(join(output,'complete.json'),JSON.stringify({maximumProviderCalls:4,mutatedMemory:false,note:'One fixed-context trial per arm; local diagnostic only, not independent route success.'},null,2));

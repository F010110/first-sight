/** Captured-state diagnostic only, NOT a fresh interleaved evaluation.
 * Uses read-only causal retrieval; never reads grading truth. */
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SpatialRetriever} from '../../agent/spatial-retrieve.js';
import {spatialContextVlm} from '../../agent/spatial-context-vlm.js';
import {spatialProtocolError} from '../../agent/spatial-context-protocol.js';
import type {SpatialLoopModel} from '../../agent/spatial-context-loop.js';
const [sourceArg,outArg,paid]=process.argv.slice(2);
if(!sourceArg||!outArg||paid!=='--confirm-paid')throw Error('Usage: original-run NEW-output --confirm-paid');
const source=resolve(sourceArg),out=resolve(outArg),load=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const records=(await readFile(join(source,'full/results.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
const questions=await load(join(source,'calendar-questions.json'));
const failures=records.filter(r=>r.error);if(failures.length!==44)throw Error('Expected original 44 failures');
const {readdir}=await import('node:fs/promises');const captured=new Map<string,Parameters<SpatialLoopModel>[0]>();
for(const directory of (await readdir(join(source,'requests'))).sort()){
 let input:Parameters<SpatialLoopModel>[0];try{input=await load(join(source,'requests',directory,'input.json'));}catch{continue;}
 const q=questions.find((q:any)=>q.question===input.question&&q.currentObservationId===input.observations.at(-1)?.id);
 if(q&&!captured.has(q.id))captured.set(q.id,input);
}
await mkdir(out,{recursive:false});await writeFile(join(out,'plan.json'),JSON.stringify({kind:'44-failure-captured-state-repair-probe',source,questions:failures.map(r=>r.id),limitations:'Captured Context intentionally reused for diagnostic only. Read-only full database is causally masked; no spatial writes, no fresh replay score. Original answers remain immutable.'},null,2));
const clock=(await load(join(source,'clock.json'))).clock,retriever=new SpatialRetriever(join(source,'memory.sqlite'));
try{
for(const failure of failures){
 const input=structuredClone(captured.get(failure.id));if(!input)throw Error('Missing captured input');
 input.evidenceImages=[];input.remainingCalls=16;
 const directory=join(out,failure.id);await mkdir(directory);
 const session=retriever.session({asOfMs:input.observations.at(-1)!.atMs-1,clock},12,16);
 const allowed=new Set<string>();const inspected=new Set(input.inspectedIds);
 const model=spatialContextVlm(join(directory,'requests'),48,1,async(atMs,value)=>{await appendFile(join(directory,'raw.jsonl'),JSON.stringify({atMs,value})+'\n');},clock);
 let result:any={id:failure.id,status:'budget-exhausted'},calls=0,inspects=0;
 for(let round=0;round<16;round++){
  input.remainingCalls=16-round;calls++;
  const decision=await model(input);await appendFile(join(directory,'outputs.jsonl'),JSON.stringify(decision)+'\n');
  input.context.outputs.push({atMs:input.context.current!.atMs,value:{question:input.question,decision,status:'unverified-model-output'}});input.context.outputs=input.context.outputs.slice(-4);
  const error=spatialProtocolError(decision,input.observations,input.question,inspected,allowed);
  if(error){input.feedback=error;continue;}
  const action=decision.next;if(!action){input.feedback='Active question requires search, inspect or answer.';continue;}
  if(action.kind==='search'){
   const hits=session.search({query:action.query,limit:4}).hits;
   input.candidates=hits.map(h=>({id:h.id,atMs:h.atMs,placeId:h.placeId,reason:h.reason,kind:'observation'}));
   for(const h of hits)allowed.add(h.id);
   input.feedback=`Search completed: ${JSON.stringify(hits.map(h=>h.id))}. Candidates are not inspected. Use inspect for matching IDs; repeating search does not open images.`;
  }else if(action.kind==='inspect'){
   const images=await session.inspect(action.ids);inspects++;
   for(const image of images){input.evidenceImages.push({id:image.id,mimeType:image.mimeType,data:image.data});inspected.add(image.id);}
   input.inspectedIds=[...inspected];input.feedback='Requested original images are now delivered. Answer the active question using them, or explicitly abstain.';
  }else if(action.kind==='answer'){
   const missing=action.abstained?[]:(input.requiredEvidenceIds??[]).filter(id=>!action.sourceIds.includes(id));
   if(missing.length){input.feedback=`Missing public question citations ${JSON.stringify(missing)}; inspect then cite, or abstain.`;continue;}
   result={id:failure.id,status:'answered',answer:action.answer,sourceIds:action.sourceIds,abstained:action.abstained,inspectedIds:[...inspected]};break;
  }else input.feedback='Active question requires an explicit answer or abstention.';
 }
 await appendFile(join(out,'results.jsonl'),JSON.stringify({...result,calls,inspectActions:inspects})+'\n');
}
await writeFile(join(out,'complete.json'),JSON.stringify({questions:44,status:'completed-diagnostic-not-semantic-score'}));
}catch(error){await writeFile(join(out,'stopped.json'),JSON.stringify({error:String(error)}));throw error;}finally{retriever.close();}

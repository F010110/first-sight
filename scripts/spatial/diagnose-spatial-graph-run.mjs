/** Offline audit of frozen sequence/graph trials. No requests or prediction edits. */
import {readFile,readdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const [sequenceRoot,graphRoot,output]=process.argv.slice(2);if(!sequenceRoot||!graphRoot||!output)throw Error('Usage: diagnose-spatial-graph-run SEQUENCE-run GRAPH-run NEW-report.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const adapter=await readFile('src/agent/spatial-json-vlm.ts');
async function load(root){
 const frozen=JSON.parse(await readFile(join(root,'frozen.json'),'utf8'));
 if(frozen.sourceHashes['src/agent/spatial-json-vlm.ts']!==sha(adapter))throw Error('Adapter changed; reconstruct payload from frozen implementation instead');
 const eventsRaw=await readFile(join(root,'events.jsonl'),'utf8');
 const events=eventsRaw.trim().split('\n').map(line=>JSON.parse(line).result),receipts=[];
 for(const entry of await readdir(join(root,'requests'),{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  let bytes;try{bytes=await readFile(join(root,'requests',entry.name,'input.json'));}catch{continue;}
  const request=JSON.parse(bytes.toString());
  const body=JSON.parse(await readFile(join(root,'requests',entry.name,'response.txt'),'utf8'));
  const answer=JSON.parse(body.choices[0].message.content);
  const aliases=new Map((request.metadata?.referenceBindings??[]).map(b=>[b.alias,b.originalId]));
  let payloadSha256=null;
  if(request.phase==='perception'){
   const content=[{type:'text',text:request.prompt+'\nINPUT='+JSON.stringify(request.data)}];
   for(const image of request.images){const imageBytes=await readFile(image.path);if(sha(imageBytes)!==image.sha256)throw Error('Original image changed');content.push({type:'text',text:`${image.id===request.data.current.id?'CURRENT':'REFERENCE'} sourceId=${image.id} direction=${image.direction}`},{type:'image_url',image_url:{url:'data:image/png;base64,'+imageBytes.toString('base64')}});}
   payloadSha256=sha(JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:1000,response_format:{type:'json_object'},messages:[{role:'user',content}]}));
  }
  receipts.push({path:entry.name,currentId:aliases.get(request.data.current.id)??request.data.current.id,atMs:request.data.current.atMs,phase:request.phase,inputSha256:sha(bytes),payloadSha256,answer,visitRelationCount:request.data.visitMemory?.places.reduce((n,p)=>n+p.relations.length,0)??0});
 }
 return {root,frozen,events,receipts,eventsSha256:sha(eventsRaw)};
}
const [sequence,graph]=await Promise.all([load(sequenceRoot),load(graphRoot)]);
if(sequence.frozen.inputSha256!==graph.frozen.inputSha256||JSON.stringify(sequence.frozen.sourceHashes)!==JSON.stringify(graph.frozen.sourceHashes))throw Error('Trials do not share frozen source and implementation');
const matches=[];
for(const r of sequence.receipts.filter(r=>r.phase==='perception')){
 const other=graph.receipts.find(g=>g.phase==='perception'&&g.currentId===r.currentId);if(!other)continue;
 matches.push({observationId:r.currentId,sequenceRequest:r.path,graphRequest:other.path,sameReceipt:r.inputSha256===other.inputSha256,sameReconstructedPayload:r.payloadSha256===other.payloadSha256,parsedAnswerDifferent:JSON.stringify(r.answer)!==JSON.stringify(other.answer),payloadSha256:r.payloadSha256});
}
const identity=r=>r.placeId===null?null:r.groups.find(g=>g.id===r.placeId).scope.sourceIds.join('|');
const first=sequence.events.find(r=>{const other=graph.events.find(g=>g.id===r.id);return other&&identity(r)!==identity(other);});
const origin=sequence.events[0].atMs;
const unknown=graph.events.filter(r=>r.placeId===null).map(r=>({observationId:r.id,seconds:(r.atMs-origin)/1000,belongs:r.reviews.filter(v=>v.evaluation.verdict==='belongs').length,capBlocked:!!r.resolution?.groupChecks.some(c=>c.evidence.includes('exceeds 12-image cap')),resolution:r.resolution}));
const thirty=graph.events.find(r=>r.atMs-origin===30000);
const report={schema:'spatial-graph-diagnosis-v1',modelCalls:0,inputSha256:graph.frozen.inputSha256,sourceHashes:graph.frozen.sourceHashes,runs:[sequence,graph].map(r=>({root:r.root,eventsSha256:r.eventsSha256})),independentPerception:{paired:matches.length,identicalPayloads:matches.filter(r=>r.sameReconstructedPayload).length,differentParsedAnswers:matches.filter(r=>r.sameReconstructedPayload&&r.parsedAnswerDifferent).length,note:'Different JSON includes wording differences, NOT proof of different semantic truth. Fingerprint reconstructs request body from unchanged adapter and verified images, not headers/provider internal state.',matches},firstMembershipDivergence:first?{observationId:first.id,seconds:(first.atMs-origin)/1000,sequenceAction:first.action,graphAction:graph.events.find(r=>r.id===first.id).action,sequenceRelationCounts:sequence.receipts.filter(r=>r.atMs===first.atMs&&r.phase==='identity').map(r=>r.visitRelationCount),graphRelationCounts:graph.receipts.filter(r=>r.atMs===first.atMs&&r.phase==='identity').map(r=>r.visitRelationCount)}:null,unknownCount:unknown.length,capBlockedUnknownCount:unknown.filter(u=>u.capBlocked).length,unknown,thirtySecondDecision:thirty?{action:thirty.action,reviews:thirty.reviews}:null,conclusion:'Observed chain: differing upstream perception/scopes before graph edges, extra place at 30s, competing memberships, all-original comparative cap, repeated unknowns. No causal proof that graph relations caused the split; graph hints may reinforce erroneous assignments but cannot correct/merge/retract them in this implementation.'};
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,matches:undefined,sourceHashes:undefined,unknown:undefined,thirtySecondDecision:undefined,independentPerception:{...report.independentPerception,matches:undefined}}));

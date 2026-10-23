/** Offline frozen-run scoring. No model calls and no prediction-as-truth accuracy. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const [batch,output]=process.argv.slice(2);if(!batch||!output)throw Error('Usage: score-spatial-repeat-batch BATCH NEW-OUTPUT');
await mkdir(dirname(resolve(output)),{recursive:true});await mkdir(output,{recursive:false});const read=async p=>JSON.parse(await readFile(p,'utf8'));const sha=b=>createHash('sha256').update(b).digest('hex');
const status=await read(join(batch,'status.json'));const runs=[];let inputHash,sourceHash;
for(const trial of status.trials){
 const root=trial.runRoot,frozen=await read(join(root,'frozen.json')),input=await readFile(join(root,'public-input.json'));
 if(sha(input)!==frozen.inputSha256)throw Error('Changed frozen input');
 inputHash??=frozen.inputSha256;sourceHash??=JSON.stringify(frozen.sourceHashes);
 if(inputHash!==frozen.inputSha256||sourceHash!==JSON.stringify(frozen.sourceHashes))throw Error('Non-equivalent frozen inputs/sources');
 const bytes=await readFile(join(root,'events.jsonl'));const events=bytes.toString().trim().split('\n').filter(Boolean).map(l=>JSON.parse(l).result);
 const predictions=(await read(join(root,'predictions.json'))).predictions;const usage=await read(join(root,'requests/usage.json'));
 const requests=[];
 for(const entry of await readdir(join(root,'requests'),{withFileTypes:true}))if(entry.isDirectory()){
  try{const value=await read(join(root,'requests',entry.name,'input.json'));const response=await read(join(root,'requests',entry.name,'response.txt'));const aliases=new Map((value.metadata?.referenceBindings??[]).map(b=>[b.alias,b.originalId]));requests.push({path:entry.name,phase:value.phase,id:aliases.get(value.data.current.id)??value.data.current.id,atMs:value.data.current.atMs,inputHash:sha(JSON.stringify(value)),answer:JSON.parse(response.choices[0].message.content),relationCount:value.data.visitMemory?.places?.reduce((s,p)=>s+p.relations.length,0)??0});}catch(error){requests.push({path:entry.name,error:String(error)});}
 }
 const unknown=events.filter(e=>!e.placeId),cap=unknown.filter(e=>e.resolution?.groupChecks?.some(c=>c.evidence.includes('exceeds 12-image cap')));
 const labels=events.map(e=>({id:e.id,seconds:(e.atMs-events[0].atMs)/1000,place:e.placeId?events.at(-1).groups.find(g=>g.id===e.placeId)?.scope.sourceIds.join('|'):null,action:e.action,region:e.perception?.region,clearRegion:e.perception?.clearRegion,cap:cap.includes(e),reviews:e.reviews.map(r=>({groupId:r.groupId,verdict:r.evaluation.verdict}))}));
 runs.push({trial:trial.id,round:trial.round,method:trial.method,root,eventsSha256:sha(bytes),planned:predictions.length,completed:events.length,failed:predictions.filter(p=>p.status==='failed').length,pending:predictions.filter(p=>p.status==='pending').length,groups:events.at(-1)?.groups.length,unknown:unknown.length,coverage:(events.length-unknown.length)/predictions.length,capUnknown:cap.length,otherUnknown:unknown.length-cap.length,unclear:events.filter(e=>e.perception?.clearRegion===false).length,calls:usage.calls,cost:usage.estimatedUSD,unknownCallsReserved:usage.unknownCallsReserved,labels,scopes:events.at(-1)?.groups.map(g=>({id:g.id,scope:g.scope,members:g.members.map(m=>m.id)})),requests});
}
const compare=(a,b)=>{let bothKnown=0,changed=0,unknownAffected=0;for(let i=0;i<a.labels.length;i++)for(let j=i+1;j<a.labels.length;j++){const x=[a.labels[i].place,a.labels[j].place],y=[b.labels[i].place,b.labels[j].place];if([...x,...y].includes(null)){unknownAffected++;continue;}bothKnown++;if((x[0]===x[1])!==(y[0]===y[1]))changed++;}return {a:a.trial,b:b.trial,bothKnownPairs:bothKnown,changedKnownPairs:changed,knownPairAgreement:bothKnown?1-changed/bothKnown:null,unknownAffectedPairs:unknownAffected};};
const stats=values=>({mean:values.reduce((s,v)=>s+v,0)/values.length,min:Math.min(...values),max:Math.max(...values)});
const methods=['recall','sequence','graph'].map(method=>{const r=runs.filter(r=>r.method===method);const stability=[];for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++)stability.push(compare(r[i],r[j]));return {method,completedTrials:r.length,coverage:stats(r.map(r=>r.coverage)),groups:stats(r.map(r=>r.groups)),unknown:stats(r.map(r=>r.unknown)),capUnknown:stats(r.map(r=>r.capUnknown)),calls:stats(r.map(r=>r.calls)),cost:stats(r.map(r=>r.cost)),stability};});
const paired=[];for(let round=1;round<=3;round++){const r=runs.filter(r=>r.round===round);for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++)paired.push(compare(r[i],r[j]));}
const perception=[];for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){
 let sameInput=0,differentAnswer=0,clearFlagChanged=0;for(const a of runs[i].requests.filter(r=>r.phase==='perception')){const b=runs[j].requests.find(r=>r.phase==='perception'&&r.id===a.id);if(b&&b.inputHash===a.inputHash){sameInput++;if(JSON.stringify(a.answer)!==JSON.stringify(b.answer))differentAnswer++;if(a.answer.clearRegion!==b.answer.clearRegion)clearFlagChanged++;}}
 perception.push({a:runs[i].trial,b:runs[j].trial,sameInput,differentAnswer,clearFlagChanged});
}
const report={schema:'spatial-repeat-score-v1',modelCallsAdded:0,inputHash,sourceHashes:JSON.parse(sourceHash),batch:resolve(batch),methods,paired,perception,runs,accuracy:null,note:'No independently labeled campus ground truth supplied. Coverage and agreement are NOT accuracy; known-only pair agreement is selection-biased. Three stochastic repetitions of one clip do not establish generalization or graph causality.'};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({methods,runs:runs.map(({requests,labels,scopes,...r})=>r),perceptionTotals:{sameInput:perception.reduce((s,r)=>s+r.sameInput,0),differentAnswer:perception.reduce((s,r)=>s+r.differentAnswer,0),clearFlagChanged:perception.reduce((s,r)=>s+r.clearFlagChanged,0)}}));

/** Independent targeted diagnostic grading. Never consumed by probe/recognition. */
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
const [probeArg,sourceArg,bankArg,paid]=process.argv.slice(2);if(!probeArg||!sourceArg||!bankArg||paid!=='--confirm-paid')throw Error('Usage: probe source bank --confirm-paid');
const probe=resolve(probeArg),source=resolve(sourceArg),out=join(probe,'semantic-grading');
const load=async(p:string)=>JSON.parse(await readFile(p,'utf8')),lines=async(p:string)=>(await readFile(p,'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
const complete=await load(join(probe,'complete.json')),records=await lines(join(probe,'results.jsonl'));if(complete.questions!==44||records.length!==44||new Set(records.map(r=>r.id)).size!==44)throw Error('Require complete unique 44-probe');
const frozen=await load(join(source,'frozen.json')),truthBytes=await readFile(join(resolve(bankArg),'evaluation-only/tasks.json'));if(createHash('sha256').update(truthBytes).digest('hex')!==frozen.privateTasksSha256)throw Error('Truth changed');
const tasks=JSON.parse(truthBytes.toString()),rows=await lines(join(source,'model-replay/observations.jsonl'));
const oldRubric=await load(join(source,'full-grading/rubric.json'));await mkdir(out,{recursive:false});await writeFile(join(out,'rubric.json'),JSON.stringify({...oldRubric,scope:'44 originally unanswered tasks only, captured-state diagnostic; not full replay score'},null,2));
const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing provider');
let calls=0,cost=0;const grades:any[]=[];
try{for(const record of records){
 const task=tasks.find((t:any)=>t.id===record.id);if(!task)throw Error('Unknown task');
 if(record.status!=='answered'){const grade={id:record.id,utility:0,harm:0,error:'no-final-answer'};grades.push(grade);await appendFile(join(out,'grades.jsonl'),JSON.stringify(grade)+'\n');continue;}
 const citations:string[]=record.sourceIds,inspected:string[]=record.inspectedIds;
 const invalid=citations.some(id=>!inspected.includes(id)||!rows.some(r=>r.id===id&&r.atMs<task.queryAtMs));
 const referenceSatisfied=task.validEvidenceSets.some((set:string[])=>set.every(id=>citations.includes(id)));
 const ids=[...new Set<string>([...task.validEvidenceSets.flat(),...citations])].slice(0,4);
 const content:any[]=[{type:'text',text:JSON.stringify({question:task.question,referenceAnswer:task.expectedAnswer,answerable:task.answerable,predictedAnswer:record.answer,abstained:record.abstained})}];
 for(const id of ids){const row=rows.find(r=>r.id===id);if(!row)throw Error('Unknown image');content.push({type:'text',text:JSON.stringify({evidenceId:id,cited:citations.includes(id),reference:task.validEvidenceSets.flat().includes(id)})});for(const camera of ['front','left','right'])content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+(await readFile(row.cameras[camera])).toString('base64')}});}
 if(cost+.02>3)throw Error('Diagnostic grading safety cap');calls++;
 const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:600,response_format:{type:'json_object'},messages:[{role:'system',content:oldRubric.rubric},{role:'user',content}]}),signal:AbortSignal.timeout(120000)});
 const text=await response.text();await writeFile(join(out,record.id+'-judge.json'),text);if(!response.ok)throw Error('Judge HTTP '+response.status);
 const body=JSON.parse(text);if(!Number.isFinite(body.usage?.prompt_tokens)||!Number.isFinite(body.usage?.completion_tokens))throw Error('Missing usage');cost+=(body.usage.prompt_tokens*.1356+body.usage.completion_tokens*.4584)/1e6;
 const judged=JSON.parse(body.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(![0,.5,1].includes(judged.credit)||![0,.25,1].includes(judged.harm))throw Error('Invalid grade');
 const harm=Math.max(judged.harm,invalid?1:0,!task.answerable&&!record.abstained?1:0);
 const utility=task.answerable?(!record.abstained&&referenceSatisfied&&!invalid&&harm<1?judged.credit:0):(record.abstained&&harm===0?judged.credit:0);
 const grade={id:record.id,tier:task.memoryTier,semanticCredit:judged.credit,utility,harm,referenceSatisfied,invalidCitations:invalid,reason:judged.reason};grades.push(grade);await appendFile(join(out,'grades.jsonl'),JSON.stringify(grade)+'\n');await writeFile(join(out,'usage.json'),JSON.stringify({calls,estimatedUSD:cost}));
}
await writeFile(join(out,'summary.json'),JSON.stringify({status:'completed-targeted-diagnostic',questions:44,fullCredit:grades.filter(g=>g.utility===1).length,partialCredit:grades.filter(g=>g.utility===.5).length,zeroCredit:grades.filter(g=>g.utility===0).length,utilityPercent:grades.reduce((s,g)=>s+g.utility,0)/44*100,scope:'Captured-state repair of 44 failures, NOT new complete 90-question score; same-family fresh-context automated judge, no human review'},null,2));
}catch(error){await writeFile(join(out,'stopped.json'),JSON.stringify({error:String(error),calls,estimatedUSD:cost,graded:grades.length}));throw error;}

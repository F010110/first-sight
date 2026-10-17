/** Separate evaluator process. Private labels never enter recognition/QA. */
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
const [prepared,bank,phase,paid]=process.argv.slice(2);if(!prepared||!bank||!['smoke','full'].includes(phase??'')||paid!=='--confirm-paid')throw Error('Usage: prepared bank smoke|full --confirm-paid');
const root=resolve(prepared),out=join(root,phase!+'-grading');await mkdir(out,{recursive:false});
const codeFreeze=JSON.parse(await readFile(join(root,'code-freeze.json'),'utf8'));for(const [path,expected] of Object.entries(codeFreeze.files)){if(createHash('sha256').update(await readFile(path)).digest('hex')!==expected)throw Error('Compiled evaluation policy changed after freeze');}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');const frozen=JSON.parse(await readFile(join(root,'frozen.json'),'utf8'));
const truthText=await readFile(join(resolve(bank),'evaluation-only','tasks.json'),'utf8');if(hash(truthText)!==frozen.privateTasksSha256)throw Error('Private task bank changed');
const tasks=JSON.parse(truthText) as any[];const source=(await readFile(join(root,'model-replay','observations.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
const records=(await readFile(join(root,phase!,'results.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
const execution=JSON.parse(await readFile(join(root,phase!,'complete.json'),'utf8'));const expectedExecutions=phase==='smoke'?18:270;
if(execution.status!=='completed'||records.length!==expectedExecutions||new Set(records.map(r=>r.id+':'+r.mode)).size!==expectedExecutions)throw Error('Incomplete or duplicate execution; no complete scorecard may be issued');
const api=process.env.QWEN_BASE_URL,key=process.env.QWEN_API_KEY;if(!api||!key)throw Error('Provider configuration missing');
const grades:any[]=[];let calls=0,input=0,output=0;const maxCost=phase==='smoke'?.2:1.5;
const usd=()=>input*.1356/1e6+output*.4584/1e6;
const rubric='You are a blind evaluator of a visual memory answer. Input includes a question, source-assisted reference answer, inspected/cited original frames, and optionally canonical evidence frames. Grade every factual claim in the response, not only target keywords. credit is 1 for correct target, .5 for partial useful target without critical contradiction, 0 for wrong or abstained on an answerable task. For unanswerable questions credit=1 only for an explicit appropriately scoped refusal without invented facts. harm=1 for fabricated unknowable facts, wrong place/floor, asserting unobserved state as known, or other misleading factual claims; .25 for unsupported ancillary detail that does not change action; 0 for correct or appropriately qualified response. Do not trust answer confidence. Missing historical citations are checked outside this judge; judge semantic content honestly even if a correct answer was guessed. Do not infer the condition or system identity. Return only JSON {"credit":0|0.5|1,"harm":0|0.25|1,"reason":string}. Reference labels are assistant-reviewed development labels, not independent human ground truth.';
await writeFile(join(out,'rubric.json'),JSON.stringify({rubric,model:'qwen3.8-flash',enableThinking:false,rubricSha256:hash(rubric),judgeIndependence:'Fresh context, same model family; no independent human review',maxEstimatedUSD:maxCost,priceBasis:'Published PAI Token Service China Beijing; estimate not invoice'},null,2));
try{
 for(const record of records){
  const t=tasks.find(t=>t.id===record.id);if(!t)throw Error('Unknown executed task');
  if(record.error){grades.push({id:t.id,mode:record.mode,semanticCredit:0,utility:0,harm:0,error:record.error});continue;}
  const result=record.result;let parsed:any;try{parsed=JSON.parse(result.raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{parsed={answer:result.raw,abstained:false,historicalEvidenceIds:[]};}
  const citations:string[]=Array.isArray(parsed.historicalEvidenceIds)?parsed.historicalEvidenceIds.filter((x:unknown)=>typeof x==='string'):[];const inspected=record.inspectedIds??[];
  const expectedEvidence=t.validEvidenceSets as string[][];
  const invalid=citations.some((id:string)=>!inspected.includes(id)||!source.some(r=>r.id===id&&r.atMs<t.queryAtMs));
  const referenceSatisfied=expectedEvidence.some(g=>g.every(id=>citations.includes(id)));
  const ids=[...new Set<string>([...expectedEvidence.flat(),...citations.filter(id=>source.some(r=>r.id===id))])].slice(0,4);
  const text={question:t.question,referenceAnswer:t.expectedAnswer,answerable:t.answerable,predictedAnswer:parsed.answer,abstained:parsed.abstained};
  const content:any[]=[{type:'text',text:JSON.stringify(text)}];
  for(const id of ids){const row=source.find(r=>r.id===id);if(!row)throw Error('Unknown grading evidence');content.push({type:'text',text:JSON.stringify({evidenceId:id,cited:citations.includes(id),reference:expectedEvidence.flat().includes(id)})});for(const view of ['front','left','right'])content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+(await readFile(row.cameras[view])).toString('base64')}});}
  if(calls>=records.length||usd()+(128000*.1356+600*.4584)/1e6>maxCost)throw Error('Pre-call judging budget exceeded');calls++;
  const response=await fetch(api.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:600,messages:[{role:'system',content:rubric},{role:'user',content}]}),signal:AbortSignal.timeout(120000)});
  const body=await response.json() as any;await writeFile(join(out,`${t.id}-${record.mode}-judge.json`),JSON.stringify({status:response.status,response:body},null,2));
  if(!response.ok||!Number.isFinite(body.usage?.prompt_tokens)||!Number.isFinite(body.usage?.completion_tokens))throw Error('Judge request/usage failure; stopping');
  input+=body.usage.prompt_tokens;output+=body.usage.completion_tokens;
  const grade=JSON.parse(body.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
  if(![0,.5,1].includes(grade.credit)||![0,.25,1].includes(grade.harm))throw Error('Invalid judge schema');
  const harm=Math.max(grade.harm,invalid?1:0,!t.answerable&&!parsed.abstained?1:0);
  const utility=record.modelOutputRejected?0:t.answerable?(!parsed.abstained&&referenceSatisfied&&!invalid&&harm<1?grade.credit:0):(parsed.abstained&&harm===0?grade.credit:0);
  const g={id:t.id,mode:record.mode,tier:t.memoryTier,answerSha256:hash(result.raw),semanticCredit:grade.credit,utility,harm,modelOutputRejected:record.modelOutputRejected??false,referenceEvidenceSatisfied:referenceSatisfied,invalidCitations:invalid,reason:grade.reason};grades.push(g);
  await appendFile(join(out,'grades.jsonl'),JSON.stringify(g)+'\n');await writeFile(join(out,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens:output,estimatedUSD:usd(),maxEstimatedUSD:maxCost},null,2));
 }
 const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 const report=['current-only','recent-5min','full-history'].map(mode=>({mode,byTier:['current','short','long'].map(tier=>{const rows=grades.filter(g=>g.mode===mode&&g.tier===tier);return {tier,questions:rows.length,taskSolutionScore:mean(rows.map(g=>g.utility*100)),answerTrustScore:mean(rows.map(g=>(1-g.harm)*100)),semanticCorrectnessDiagnostic:mean(rows.map(g=>g.semanticCredit*100))};})}));
 const full=grades.filter(g=>g.mode==='full-history');const difficult=full.filter(g=>g.tier==='long'||tasks.find(t=>t.id===g.id)?.family==='compare');
 const cards={'实际问题解决':mean(full.map(g=>g.utility*100)),'长程与干扰':mean(difficult.map(g=>g.utility*100)),'回答可信':mean(full.map(g=>(1-g.harm)*100))};
 await writeFile(join(out,'scorecard.json'),JSON.stringify({status:'completed-development-model-judged',profile:'memory-horizons-v1',questions:records.length,cards,conditions:report,annotationReview:'assistant-source-assisted; not external human ground truth',judgeReview:'same model family fresh-context automated grading; no human review',unmeasured:['object-state-change','natural-object-search','independent-environment-generalization'],note:'Three cards describe this static-memory profile only; long/interference includes long tier and comparison tasks, not state change. No combined total. Semantic correctness is diagnostic only; compare it across modes to detect guessing. All reference evidence must be inspected and cited.'},null,2));
 await writeFile(join(out,'complete.json'),JSON.stringify({status:'completed',grades:grades.length}));
}catch(error){await writeFile(join(out,'stopped.json'),JSON.stringify({error:String(error),calls,inputTokens:input,outputTokens:output,estimatedUSD:usd(),graded:grades.length},null,2));throw error;}

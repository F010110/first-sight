import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OrganizedExperienceMemory,type ExperienceFact} from './organized-experience-memory.js';
import {answerCausalContextQuestionV2} from './causal-context-question-v2.js';
import type {ThreeAgentStore} from './three-agent-store.js';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import {createHash} from 'node:crypto';
import {spatialJsonVlm} from '../agent/spatial-json-vlm.js';
import {aliasedSpatialRequest} from '../agent/spatial-reference-aliases.js';
import {SpatialOutputProtocolError} from '../agent/spatial-protocol-retry.js';

test('empty early snapshot does not import organization fact zero',async()=>{
 const f=await fixture();
 try{
  const answer=await answerCausalContextQuestionV2('眼前是什么?',{...f.row,atMs:10000},{...f.snapshot,asOfMs:10000,results:[]},async()=>({kind:'answer',text:'当前画面。',target:'当前',sourceIds:['now'],contextRefs:[],memoryRefs:[],abstained:false}),async()=>[],f.observation,{organization:f.organization});
  assert.equal(answer.text,'当前画面。');
 }finally{await f.cleanup();}
});

test('bounded alias feedback and unknown uncertainty preserve source namespaces',async()=>{
 const f=await fixture();let answering=0,research=0;
 try{
  const answer=await answerCausalContextQuestionV2('最开始的柜台是什么样?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='answer'){
    answering++;
    if(answering===1)throw new SpatialOutputProtocolError('Unknown model reference alias: context:bad');
    if(answering===2){assert.match(JSON.stringify(data.history),/protocol.error/);return {kind:'answer',text:'当前柜台',target:'当前',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:false};}
     if(answering===3){assert.match(JSON.stringify(data.history),/Uncited answer/);return {kind:'memory.investigate',need:'查早期记录'};}
    return {kind:'answer',text:'早期柜台为木色。',target:'早期柜台',sourceIds:[],contextRefs:[],memoryRefs:['memory-v4'],abstained:false};
   }
   research++;
   if(research===1)throw new SpatialOutputProtocolError('Unknown model reference alias: S99');
   if(research===2)return {kind:'read'};
   const result={kind:'report',status:'supported',reasoningKind:'attribute',summary:'木色柜台',memoryRefs:research===3?['S0']:['memory-v4'],events:[]};
   if(research===4){assert.match(JSON.stringify(data.history),/not fully read or not delivered/);assert.ok(data.readReferenceIndex.some((r:any)=>r.memoryRef==='memory-v4'&&r.observationId==='o3'));}
   return result;
  },async()=>[],f.observation,{organization:f.organization});
  assert.ok('investigations' in answer.audit);
  assert.equal(answer.audit.investigations[0]!.report.unresolved,null);
  assert.equal(answer.audit.investigations[0]!.report.uncertaintyDeclared,false);
  assert.equal(research,4);assert.equal(answering,4);
 }finally{await f.cleanup();}
});

const descriptions=['走出地下站出口到街道','沿街行走，只看到店铺外立面','街边门口，未确定进入','室内第一处柜台为木色','再次出现在街道','另一扇门口接近柜台','室内第二处柜台为蓝色'];
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'opencode/investigate-')),organization=new OrganizedExperienceMemory(join(dir,'memory.sqlite'));
 const facts:ExperienceFact[]=descriptions.map((text,i)=>({memoryRef:`memory-v${i+1}`,observationId:`o${i}`,atMs:i*1000,sourceAtMs:i*1000,availableAtMs:100,recordingId:'r',text,views:[{direction:'front',path:`${i}.png`,sha256:'a'.repeat(64)}],rawResultJSON:'{}'}));
 for(const fact of facts)organization.append(fact);
 organization.append({...facts[0]!,memoryRef:'memory-v99',observationId:'late',atMs:10000,availableAtMs:900,text:'UNAVAILABLE_PRIVATE_SENTINEL'});
 organization.append({...facts[0]!,memoryRef:'memory-v100',observationId:'future',atMs:400000,text:'FUTURE_SENTINEL'});
 const snapshot={asOfMs:300000,results:facts.map(f=>({lane:'memory',observation_id:f.observationId,source_at_ms:f.atMs,available_at_ms:f.availableAtMs,evidence_until_ms:f.atMs,memoryRef:f.memoryRef,result:{summary:f.text}}))} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 const row:SpatialObservation={id:'now',atMs:300000,frames:['now.png']};
 const observation=(id:string)=>{const fact=facts.find(f=>f.observationId===id);return fact?{id,atMs:fact.atMs,frames:[`${id}.png`]}:row;};
 return {dir,organization,snapshot,row,observation,cleanup:async()=>{organization.close();await rm(dir,{recursive:true,force:true});}};
}
const report=()=>({kind:'report',status:'supported',summary:'记录中的后一处柜台为蓝色。',memoryRefs:['memory-v1','memory-v3','memory-v4','memory-v6','memory-v7'],unresolved:[]});

test('organized runtime delegates chronological investigation, not a smart locate; previews cannot certify the second entry',async()=>{
 const f=await fixture();let answerTurns=0,researchTurns=0;
 try{
  const answer=await answerCausalContextQuestionV2('离开地下站后第二家店的柜台是什么样?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   assert.ok(!JSON.stringify(data).includes('SENTINEL'));
   if(data.role==='answer'){
    answerTurns++;
    if(answerTurns===1){assert.ok(!JSON.stringify(data).includes(descriptions[6]!));return {kind:'memory.locate',query:'第二家店'};}
    if(answerTurns===2){assert.match(JSON.stringify(data.history),/delegate memory.investigate/);return {kind:'memory.investigate',need:'先核对出口及后续两次进入，再查第二处柜台'};}
     assert.equal(data.history[1].result.report.memoryRefs.length,5);
    assert.ok(!('history' in data.history[1].result));
    return {kind:'answer',text:'记录中的第二处柜台为蓝色。',target:'出口后的第二处候选店内柜台',sourceIds:[],contextRefs:[],memoryRefs:['memory-v7'],abstained:false};
   }
   assert.equal(data.role,'memory-investigator');researchTurns++;
   assert.ok(!('candidate' in data));
   if(researchTurns===1)return {kind:'timeline',cursor:0};
   if(researchTurns===2)return report();
   if(researchTurns===3){assert.match(JSON.stringify(data.history),/fully read/);return {kind:'read'};}
   assert.equal(data.progress.fullyRead,7);return report();
  },async()=>[],f.observation,{organization:f.organization});
  assert.equal(answer.audit.schema,'memory-investigation-question-v1');assert.equal(answerTurns,3);assert.equal(researchTurns,4);
  assert.ok('investigations' in answer.audit);
   assert.equal(answer.audit.investigations[0]!.report.coverage.semanticCoverageCertified,false);
  assert.deepEqual(answer.memoryRefs,['memory-v7']);
 }finally{await f.cleanup();}
});

test('generic reports do not require task-specific fields or certify semantic coverage',async()=>{
 const f=await fixture();let researchTurns=0;
 try{
  const answer=await answerCausalContextQuestionV2('第二家店?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='answer')return data.history.length?{kind:'answer',text:'还不能确认进入顺序。',target:'第二家店尚未确定',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true}:{kind:'memory.investigate',need:'核查顺序'};
   researchTurns++;
   if(researchTurns===1)return {kind:'read',afterMs:0,beforeMs:0};
   if(researchTurns===2)return {kind:'read',afterMs:2000,beforeMs:3000};
   if(researchTurns===3)return {kind:'read',afterMs:5000,beforeMs:6000};
    assert.doesNotMatch(input.prompt,/ordinalIndex|anchorRefs|visits|先用timeline/);
    return report();
  },async()=>[],f.observation,{organization:f.organization});
  assert.ok('investigations' in answer.audit);
   assert.equal(answer.audit.investigations[0]!.report.coverage.semanticCoverageCertified,false);
   assert.equal(answer.audit.investigations[0]!.report.coverage.fullyRead,5);
   assert.ok(!('ordinalIndex' in answer.audit.investigations[0]!.report));
  assert.equal(answer.abstained,true);
 }finally{await f.cleanup();}
});

test('failed investigation is not repeatedly relaunched and budget/provider error remains visible',async()=>{
 const f=await fixture();let researchers=0,answers=0;
 try{
  const answer=await answerCausalContextQuestionV2('过去的店?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='memory-investigator'){researchers++;throw Error('Research provider budget denied');}
   answers++;
   if(answers<3)return {kind:'memory.investigate',need:'翻阅历史'};
   assert.match(JSON.stringify(data.history),/including failed attempts/);
   return {kind:'answer',text:'本次记忆调查未完成，无法确认。',target:'历史店铺未确认',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true};
  },async()=>[],f.observation,{organization:f.organization});
  assert.equal(researchers,1);assert.equal(answer.abstained,true);
  assert.match(JSON.stringify(answer.audit.history),/Research provider budget denied/);
 }finally{await f.cleanup();}
});

test('retired target-verification route cannot silently invoke direct locate in organized runtime',async()=>{
 const f=await fixture();let calls=0;
 try{
  await assert.rejects(answerCausalContextQuestionV2('旧问题',f.row,f.snapshot,async()=>{calls++;},async()=>[],f.observation,{organization:f.organization,verifyTarget:true}),/retired/);
  assert.equal(calls,0);
 }finally{await f.cleanup();}
});

test('investigator calls and failures remain bounded even when no valid tool/report is produced',async()=>{
 const f=await fixture();let researchers=0,answers=0;
 try{
  const answer=await answerCausalContextQuestionV2('历史情况?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='memory-investigator'){researchers++;return {kind:'memory.locate',query:'猜目标'};}
   answers++;
   return answers===1?{kind:'memory.investigate',need:'按记录调查'}:{kind:'answer',text:'调查在预算内未能完成。',target:'历史情况未确定',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true};
  },async()=>[],f.observation,{organization:f.organization});
  assert.equal(researchers,32);assert.equal(answers,2);assert.equal(answer.abstained,true);
  assert.match(JSON.stringify(answer.audit.history),/Investigation turn budget exhausted/);
 }finally{await f.cleanup();}
});

test('active literal hints, context expansion, coverage, recall and follow-up investigation reuse read evidence',async()=>{
 const f=await fixture();let answers=0,research=0;
 try{
  const answer=await answerCausalContextQuestionV2('两处柜台有什么不同?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='answer'){
    answers++;
    if(answers===1)return {kind:'memory.investigate',need:'先找柜台，再检查前后场景'};
    if(answers===2)return {kind:'memory.investigate',need:'已有一方，请补查另一方并比较，不凭名称认同一店'};
    return {kind:'answer',text:'记录中较早一处为木色，后一处为蓝色。',target:'两处历史柜台',sourceIds:[],contextRefs:[],memoryRefs:['memory-v4','memory-v7'],abstained:false};
   }
   research++;
   if(research===1)return {kind:'find',terms:['不存在的词'],match:'any'};
   if(research===2){assert.match(JSON.stringify(data.history),/No literal match is not absence/);return {kind:'find',terms:['柜台'],match:'all'};}
   if(research===3)return {kind:'around',memoryRef:'memory-v4',before:3,after:3};
   if(research===4)return {kind:'coverage'};
   if(research===5){assert.equal(data.history.at(-1).result.unread,0);return {kind:'recall',memoryRefs:['memory-v7']};}
   if(research===6)return {kind:'report',status:'incomplete',reasoningKind:'comparison',summary:'已找到较早的木色柜台，仍需对照另一处。',memoryRefs:['memory-v4'],events:[],unresolved:['另一处柜台尚待对照']};
   assert.equal(data.progress.fullyRead,7);
   assert.ok(data.history.some((h:any)=>h.action.kind==='around'));
   return {kind:'report',status:'supported',reasoningKind:'comparison',summary:'木色与蓝色两处柜台可作属性对比，不证明同一店。',memoryRefs:['memory-v4','memory-v7'],events:[],unresolved:[]};
  },async()=>[],f.observation,{organization:f.organization});
  assert.ok('investigations' in answer.audit);assert.equal(answer.audit.investigations.length,2);
  assert.equal(research,7);assert.deepEqual(answer.memoryRefs,['memory-v4','memory-v7']);
 }finally{await f.cleanup();}
});

test('actual aliased HTTP adapter carries both agent sessions with JSON-only transport and accounted usage',async()=>{
 const f=await fixture(),oldFetch=globalThis.fetch,previous={key:process.env.QWEN_API_KEY,base:process.env.QWEN_BASE_URL};let calls=0;
 try{
  process.env.QWEN_API_KEY='unit-test-not-a-key';process.env.QWEN_BASE_URL='http://invalid.test';
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]),path=join(f.dir,'header-only.png');await writeFile(path,bytes);
  globalThis.fetch=async(_url,init)=>{
   calls++;const payload=JSON.parse(String(init?.body)),text=payload.messages[0].content[0].text as string;
   if(!/json/i.test(text))return new Response(JSON.stringify({error:{message:'messages must contain json'}}),{status:400});
   const data=JSON.parse(text.slice(text.indexOf('\nINPUT=')+7));let content:unknown;
   if(data.role==='answer')content=data.history.length?{kind:'answer',text:'记录中有蓝色柜台。',target:'历史柜台',sourceIds:[],contextRefs:[],memoryRefs:['memory-v7'],abstained:false}:{kind:'memory.investigate',need:'读取柜台属性'};
   else {assert.equal(payload.messages[0].content.filter((item:any)=>item.type==='image_url').length,0);content=data.history.length?{kind:'report',status:'supported',reasoningKind:'attribute',summary:'记录提到蓝色柜台。',memoryRefs:['memory-v7'],events:[],unresolved:[]}:{kind:'read'};}
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:1000,completion_tokens:100}}),{status:200});
  };
  const root=join(f.dir,'requests'),request=aliasedSpatialRequest(spatialJsonVlm(root,8,.1,true));
  const answer=await answerCausalContextQuestionV2('历史柜台什么颜色?',f.row,f.snapshot,request,async rows=>rows.map(r=>({id:r.id,direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')})),f.observation,{organization:f.organization});
  assert.equal(answer.text,'记录中有蓝色柜台。');assert.equal(calls,4);
  const ledger=JSON.parse(await readFile(join(root,'usage.json'),'utf8'));assert.equal(ledger.calls,4);assert.equal(ledger.unknownCallsReserved,0);
 }finally{globalThis.fetch=oldFetch;for(const [name,value] of [['QWEN_API_KEY',previous.key],['QWEN_BASE_URL',previous.base]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;await f.cleanup();}
});

test('optional checkpoints consolidate new sources without blocking browsing and isolate delegator guesses',async()=>{
 const f=await fixture();let research=0;
 const checkpoint=(ref:string)=>({kind:'checkpoint',summary:'新记录需要重新核对，不将旧猜测视为事实',hypotheses:[{description:'候选过程仍未确认',evidenceRefs:[ref],counterRefs:[],status:'uncertain'}],nextNeed:'补查下一条记录以核对转换'});
 try{
  const answer=await answerCausalContextQuestionV2('历史经过如何?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='answer')return data.history.length?{kind:'answer',text:'现有调查尚未确认完整经过。',target:'历史经过待核查',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true}:{kind:'memory.investigate',need:'UNVERIFIED_HINT_假定某店和某个时刻就是目标'};
   assert.ok(!JSON.stringify(data).includes('UNVERIFIED_HINT'));
   assert.equal(input.images.length,0);assert.equal(input.textOnlyIdentity,true);
   research++;
   if(research<=3)return {kind:'read',afterMs:(research-1)*1000,beforeMs:(research-1)*1000};
    if(research===4){assert.equal(data.progress.readingBatches,3);return {kind:'read',afterMs:3000,beforeMs:3000};}
    if(research===5){assert.ok(!(data.history.at(-1).result.error));return checkpoint('memory-v3');}
   if(research<=8){if(research===6){assert.equal(data.history.length,1);assert.ok(data.transcriptWindow.omittedActions>=4);}return {kind:'read',afterMs:(research-3)*1000,beforeMs:(research-3)*1000};}
   if(research===9)return checkpoint('memory-v1');
   if(research===10){assert.match(JSON.stringify(data.history.at(-1)),/newly read evidence/);return checkpoint('memory-v6');}
   assert.equal(data.notebook.hypotheses[0].evidenceRefs[0],'memory-v6');
   return {kind:'report',status:'incomplete',reasoningKind:'attribute',summary:'仍需检查后续记录',memoryRefs:['memory-v6'],events:[],unresolved:['转换未核实']};
  },async()=>[],f.observation,{organization:f.organization});
  assert.ok('investigations' in answer.audit);assert.equal(research,11);
  assert.equal(answer.audit.investigations[0]!.state.notebook!.hypotheses[0]!.status,'uncertain');
 }finally{await f.cleanup();}
});

test('unmentioned visual details can be inspected and negative search never certifies absence',async()=>{
 const f=await fixture();let research=0;
 try{
  const answer=await answerCausalContextQuestionV2('角落里是否见过一个小物件?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='answer')return data.history.length?{kind:'answer',text:'文字未命中，只检查了一处画面，不能确定是否出现过。',target:'角落小物件',sourceIds:[],contextRefs:[],memoryRefs:['memory-v4'],abstained:true}:{kind:'memory.investigate',need:'查小物件'};
   assert.ok(!('requiresHistoricalInvestigation' in data));
   assert.doesNotMatch(input.prompt,/ordinalIndex|anchorRefs|visits/);
   research++;
   if(research===1)return {kind:'find',terms:['小物件']};
   if(research===2){assert.equal(data.history.at(-1).result.totalLiteralHits,0);return {kind:'read'};}
   if(research===3)return {kind:'inspect',memoryRefs:['memory-v4']};
   if(research===4){assert.equal(data.progress.inspectedImages,1);return {kind:'coverage'};}
   assert.equal(data.history.at(-1).result.unread,0);
   assert.equal(data.history.at(-1).result.inspectedImages,1);
   assert.equal(data.history.at(-1).result.semanticCoverageCertified,false);
   return {kind:'report',status:'incomplete',summary:'文字未命中，只检查一处画面，无法排除出现过。',memoryRefs:['memory-v4'],unresolved:['其他画面未检查']};
  },async()=>[],f.observation,{organization:f.organization});
  assert.equal(answer.abstained,true);assert.equal(research,5);
 }finally{await f.cleanup();}
});

test('source feedback identifies oversized fields without task-specific report requirements',async()=>{
 const f=await fixture();let research=0;
 const cp=(evidenceRefs:string[])=>({kind:'checkpoint',summary:'候选属性待核查',hypotheses:[{description:'柜台特征',evidenceRefs,counterRefs:[],status:'candidate'}],nextNeed:'选代表记录形成报告'});
 const makeReport=(top:string[],event:string[])=>({kind:'report',status:'supported',reasoningKind:'attribute',summary:'记录显示蓝色柜台',memoryRefs:top,events:[{description:'观察柜台',memoryRefs:event}],unresolved:[]});
 try{
  const answer=await answerCausalContextQuestionV2('历史柜台特征?',f.row,f.snapshot,async input=>{
   const data=input.data as any;
   if(data.role==='answer')return data.history.length?{kind:'answer',text:'记录中有蓝色柜台。',target:'历史柜台',sourceIds:[],contextRefs:[],memoryRefs:['memory-v7'],abstained:false}:{kind:'memory.investigate',need:'查属性'};
   research++;
   if(research===1)return {kind:'read'};
   if(research===2)return cp(Array(13).fill('memory-v4'));
   if(research===3){assert.match(data.history.at(-1).result.error,/hypotheses\[0\]\.evidenceRefs: 13 references exceeds maximum 12/);return cp(['memory-v4']);}
    return {kind:'report',status:'supported',summary:'蓝色柜台',memoryRefs:['memory-v7']};
  },async()=>[],f.observation,{organization:f.organization});
   assert.ok('investigations' in answer.audit);assert.equal(research,4);
   assert.equal(answer.audit.investigations[0]!.history.filter(h=>(h.result as any).error).length,1);
 }finally{await f.cleanup();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OrganizedExperienceMemory,type ExperienceFact} from './organized-experience-memory.js';
// Preserve regression coverage of historical failed policies without exposing them in runtime.
import {answerLegacyOrganizedQuestionV1 as answerCausalContextQuestionV2} from './causal-context-question-v2.js';
import type {ThreeAgentStore} from './three-agent-store.js';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

test('organized question tools locate then retrieve actual source facts without future or oracle exposure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/organized-tools-')),memory=new OrganizedExperienceMemory(join(dir,'index.sqlite'));
 const old:ExperienceFact={memoryRef:'memory-v1',observationId:'old',atMs:0,sourceAtMs:0,availableAtMs:100,recordingId:'r',text:'地下地铁站台右侧有木质长椅',views:[{direction:'front',path:'old.png',sha256:'a'.repeat(64)}],rawResultJSON:'{}'};
 memory.append(old);memory.append({...old,memoryRef:'memory-v2',observationId:'later',atMs:1000,sourceAtMs:1000,text:'街边公交站长椅'});
 memory.append({...old,memoryRef:'memory-v3',observationId:'not-yet-known',atMs:2000,sourceAtMs:2000,availableAtMs:900,text:'future private description'});
 const snapshot={asOfMs:300000,results:[{lane:'memory',observation_id:'old',source_at_ms:0,evidence_until_ms:0,available_at_ms:100,memoryRef:'memory-v1',result:{summary:old.text}},
  {lane:'memory',observation_id:'later',source_at_ms:1000,evidence_until_ms:1000,available_at_ms:100,memoryRef:'memory-v2',result:{summary:'街边公交站长椅'}}]} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 const row:SpatialObservation={id:'now',atMs:300000,frames:['now.png']};let turns=0;
 try{
  const result=await answerCausalContextQuestionV2('最开始等车的地方座位在哪?',row,snapshot,async input=>{
   const data=input.data as any;assert.ok(!JSON.stringify(data).includes('future private'));
   if(turns++===0){assert.ok(!JSON.stringify(data).includes(old.text));return {kind:'memory.locate',query:'等车 座位',order:'earliest'};}
   if(turns===2){const candidate=data.history[0].result.candidates[0];assert.equal(candidate.evidence[0].memoryRef,'memory-v1');return {kind:'memory.facts',episodeRef:candidate.episodeRef,query:'座位'};}
   assert.ok(JSON.stringify(data).includes(old.text));return {kind:'answer',text:'当时在地铁站台右侧有木质长椅',target:'最初等车位置',sourceIds:[],contextRefs:[],memoryRefs:['memory-v1'],abstained:false};
  },async rows=>rows.map(r=>({id:r.id,direction:'front',path:'unused',sha256:'mock'})),id=>({id,atMs:0,frames:['old.png']}),{organization:memory,organizationKnownAtMs:200});
  assert.equal(result.audit.schema,'organized-context-question-v1');assert.equal(result.memoryRefs[0],'memory-v1');assert.equal(result.audit.turns,3);
 }finally{memory.close();await rm(dir,{recursive:true,force:true});}
});

test('organized policy rejects flat-search bypass without exposing persisted descriptions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/organized-routing-')),memory=new OrganizedExperienceMemory(join(dir,'index.sqlite'));
 const row:SpatialObservation={id:'now',atMs:300000,frames:['now.png']};
 const snapshot={asOfMs:300000,results:[]} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 let turns=0;
 try{
  const answer=await answerCausalContextQuestionV2('旧经历?',row,snapshot,async input=>{
   assert.ok(!input.prompt.includes('可直接使用的格式'));
   if(turns++===0)return {kind:'memory.search',query:'shop'};
   assert.match(JSON.stringify(input.data),/flat retrieval is disabled/);
   return {kind:'answer',text:'无法确认',target:'旧经历未知',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true};
  },async()=>[],()=>row,{organization:memory});
  assert.equal(answer.audit.deliveredMemory.length,0);
 }finally{memory.close();await rm(dir,{recursive:true,force:true});}
});

test('sequence tool delivers exact snapshot facts and refuses guessed episode references',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/organized-sequence-')),memory=new OrganizedExperienceMemory(join(dir,'index.sqlite'));
 const row:SpatialObservation={id:'now',atMs:300000,frames:['now.png']};
 const old:ExperienceFact={memoryRef:'memory-v1',observationId:'old',atMs:0,sourceAtMs:0,availableAtMs:100,recordingId:'r',text:'店铺招牌与柜台',views:[{direction:'front',path:'old.png',sha256:'a'.repeat(64)}],rawResultJSON:'{}'};
 memory.append(old);
 const snapshot={asOfMs:300000,results:[{lane:'memory',observation_id:'old',source_at_ms:0,evidence_until_ms:0,available_at_ms:100,memoryRef:'memory-v1',result:{summary:old.text}}]} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 let turns=0;
 try{
  const answer=await answerCausalContextQuestionV2('之前店铺里有什么?',row,snapshot,async input=>{
   const data=input.data as any;
   if(turns++===0)return {kind:'memory.sequence',episodeRef:'guessed'};
   if(turns===2){assert.match(JSON.stringify(data.history),/Locate an experience/);return {kind:'memory.locate',query:'店铺'};}
   if(turns===3)return {kind:'memory.sequence',episodeRef:data.history[1].result.candidates[0].episodeRef};
   assert.equal(data.history[2].result.confirmedEntry,false);
   return {kind:'answer',text:'记录中有柜台',target:'之前店铺内可见物品',sourceIds:[],contextRefs:[],memoryRefs:['memory-v1'],abstained:false};
  },async()=>[],()=>row,{organization:memory});
  assert.equal(answer.memoryRefs[0],'memory-v1');
 }finally{memory.close();await rm(dir,{recursive:true,force:true});}
});

test('verified policy executes target retrieval and rejects a wrong-target draft without silently editing it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/verified-target-')),memory=new OrganizedExperienceMemory(join(dir,'index.sqlite'));
 const row:SpatialObservation={id:'now',atMs:300000,frames:['now.png']};
 const old:ExperienceFact={memoryRef:'memory-v1',observationId:'old',atMs:0,sourceAtMs:0,availableAtMs:100,recordingId:'r',text:'早期店内绿色柜台',views:[{direction:'front',path:'old.png',sha256:'a'.repeat(64)}],rawResultJSON:'{}'};
 memory.append(old);
 const snapshot={asOfMs:300000,results:[{lane:'memory',observation_id:'old',source_at_ms:0,evidence_until_ms:0,available_at_ms:100,memoryRef:'memory-v1',result:{summary:old.text}}]} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 let turns=0;
 try{
  const answer=await answerCausalContextQuestionV2('早期店内柜台颜色?',row,snapshot,async input=>{
   const data=input.data as any;turns++;
   if(turns===1){assert.ok(!JSON.stringify(data).includes(old.text));return {scope:'history',relation:'attribute',target:'早期店内柜台',queries:[{text:'店内柜台',order:'earliest'}]};}
   if(turns===2){assert.ok(data.history.some((h:any)=>h.action.kind==='memory.sequence'));return {kind:'answer',text:'现在是白色',target:'当前柜台',sourceIds:['now'],contextRefs:[],memoryRefs:[],abstained:false};}
   if(turns===3)return {approved:false,reason:'当前柜台替代了历史目标'};
   if(turns===4){assert.match(JSON.stringify(data.history),/Target verification rejected/);return {kind:'answer',text:'当时是绿色',target:'早期柜台',sourceIds:[],contextRefs:[],memoryRefs:['memory-v1'],abstained:false};}
   assert.equal(data.candidate.text,'当时是绿色');assert.equal(data.inspectedForReview[0].id,'old');return {approved:true,reason:'所引原始记录支持早期目标及颜色'};
  },async()=>[],id=>id==='now'?row:{id,atMs:0,frames:['old.png']},{organization:memory,verifyTarget:true});
  assert.equal(turns,5);assert.equal(answer.text,'当时是绿色');assert.equal(answer.audit.targetReviews.length,2);
  assert.equal(answer.audit.schema,'verified-organized-question-v1');
 }finally{memory.close();await rm(dir,{recursive:true,force:true});}
});

import {test} from 'node:test';import assert from 'node:assert/strict';
import {SeparatedSpatialAgent} from './spatial-separated-agent.js';
import {parseSpatialPerception,parseSpatialIdentityAction,type SpatialPerception,type SpatialReference} from './spatial-separated-protocol.js';
import type {SpatialLoopMemory} from './spatial-context-loop.js';
const observation=(id:string,atMs:number,recordingId='r')=>({id,atMs,recordingId,frames:['front','left','right']});
const perception=(id:string):SpatialPerception=>({observationId:id,region:'current visible region',clearRegion:true,layoutEvidence:['ground beneath observer','fence beside observer'],uncertainties:[],retrievalQueries:[],sourceIds:[id]});
const action=(id:string,refs:SpatialReference[],kind:'continue'|'establish_candidate'|'revisit'|'unknown',relation:'same'|'different'|'uncertain'='same')=>({action:kind,referenceId:kind==='continue'||kind==='revisit'?refs[0]!.id:null,reason:'visible concrete layout',comparisons:refs.map(r=>({referenceId:r.id,relation,evidence:'observer side of boundary and local floor'})),sourceIds:[id,...refs.map(r=>r.id)]});
function store(){
 const assignments=new Map<string,any>();let next=0;const audit:any[]=[];
 const memory:SpatialLoopMemory={async writeObservation(){},async writeOutput(_at,value){audit.push(value);},async writeAssessment(a){const result={...a,placeId:a.placeId==='new'?`runtime-${++next}`:a.placeId};assignments.set(a.observationId,result);return result;},async search(){return [];},async inspect(ids){return ids.map(id=>({id,atMs:Number(id.slice(1)),placeId:assignments.get(id)?.placeId??null,reason:'POISON_OLD_REASON',images:[{mimeType:'image/png',data:'fixture'}]}));}};
 return {memory,assignments,audit};
}
test('current perception has no history, identity prompt has no UUID/reason; runtime binds identities',async()=>{
 const {memory}=store();let calls=0;
 const agent=new SeparatedSpatialAgent(memory,{async perceive(input){assert.deepEqual(Object.keys(input),['current']);assert.ok(!JSON.stringify(input).includes('POISON'));return perception(input.current.id);},async identify(input){assert.ok(!JSON.stringify(input).includes('runtime-'));assert.ok(!JSON.stringify(input).includes('POISON'));calls++;return action(input.current.id,input.references,calls===1?'establish_candidate':'continue');}});
 const first=await agent.observe(observation('o1',1));const second=await agent.observe(observation('o2',2));
 assert.equal(first.judgment.placeId,'runtime-1');assert.equal(second.judgment.placeId,first.judgment.placeId);assert.equal(second.segmentId,first.segmentId);assert.deepEqual(second.referenceIds,['o1']);
 await assert.rejects(agent.observe(observation('o0',0)),/monotonically/);
});
test('identity-free perception refuses hidden IDs, foreign sources and empty named regions',()=>{
 assert.throws(()=>parseSpatialPerception({...perception('o'),placeId:'leak'},'o'),/no identity/);
 assert.throws(()=>parseSpatialPerception({...perception('o'),sourceIds:['past']},'o'),/no identity/);
 assert.throws(()=>parseSpatialPerception({...perception('o'),layoutEvidence:[]},'o'),/two visible/);
});
test('explicit actions prevent same-region duplication, unknown-boundary new IDs and uninspected reuse',()=>{
 const refs:SpatialReference[]=[{id:'old',atMs:1,role:'previous',hasIdentity:true}];
 assert.throws(()=>parseSpatialIdentityAction(action('o',refs,'establish_candidate'),'o',refs,perception('o')),/positive difference/);
 assert.throws(()=>parseSpatialIdentityAction(action('o',refs,'establish_candidate','uncertain'),'o',refs,perception('o')),/uncertainty/);
 assert.equal(parseSpatialIdentityAction(action('o',refs,'establish_candidate','different'),'o',refs,perception('o')).action,'establish_candidate');
 assert.throws(()=>parseSpatialIdentityAction({...action('o',refs,'revisit'),referenceId:'invented'},'o',refs,perception('o')),/inspected/);
 assert.throws(()=>parseSpatialIdentityAction({...action('o',refs,'continue'),comparisons:[]},'o',refs,perception('o')),/Missing/);
 const unknownRefs=[{...refs[0]!,hasIdentity:false}];
 assert.equal(parseSpatialIdentityAction(action('o',unknownRefs,'establish_candidate'),'o',unknownRefs,perception('o')).action,'establish_candidate');
 assert.throws(()=>parseSpatialIdentityAction(action('o',unknownRefs,'continue'),'o',unknownRefs,perception('o')),/inspected/);
});
test('unknown preserves a same-region experience segment but never inherits the old identity',async()=>{
 const {memory}=store();let calls=0;
 const agent=new SeparatedSpatialAgent(memory,{async perceive(i){return perception(i.current.id);},async identify(i){calls++;return action(i.current.id,i.references,calls===1?'establish_candidate':'unknown');}});
 const first=await agent.observe(observation('o1',1)),second=await agent.observe(observation('o2',2));
 assert.equal(second.segmentId,first.segmentId);assert.equal(second.judgment.placeId,null);assert.equal(second.perception.region,'current visible region');
});
test('recording gaps never create a continue reference; no future original reaches identity',async()=>{
 const {memory}=store();const agent=new SeparatedSpatialAgent(memory,{async perceive(i){return perception(i.current.id);},async identify(i){assert.equal(i.references.length,0);return action(i.current.id,i.references,'establish_candidate');}});
 const first=await agent.observe(observation('o1',1)),second=await agent.observe(observation('o2',2,'other'));
 assert.equal(second.recordingGap,true);assert.notEqual(first.segmentId,second.segmentId);assert.notEqual(first.judgment.placeId,second.judgment.placeId);
 const other=store();let identityCalls=0;
 const invalid=new SeparatedSpatialAgent(other.memory,{async perceive(i){return perception(i.current.id);},async identify(i){identityCalls++;return action(i.current.id,i.references,'establish_candidate');}});
 await invalid.observe(observation('o1',1));other.memory.inspect=async()=>[{id:'o1',atMs:99,placeId:'runtime-1',reason:'future',images:[{mimeType:'image/png',data:'future'}]}];
 await assert.rejects(invalid.observe(observation('o2',2)),/causal inspected/);assert.equal(identityCalls,1);
});
test('bounded protocol failure commits no fabricated fallback; provider failure is not silently reissued',async()=>{
 const {memory,assignments,audit}=store();let calls=0;
 const invalid=new SeparatedSpatialAgent(memory,{async perceive(){calls++;return {placeId:'invented'};},async identify(){throw Error('not allowed');}});
 await assert.rejects(invalid.observe(observation('o1',1)),/Perception/);assert.equal(calls,2);assert.equal(assignments.size,0);assert.equal(audit.length,2);
 const failed=new SeparatedSpatialAgent(memory,{async perceive(){calls++;const e=new Error('HTTP failure');e.name='SpatialProviderError';throw e;},async identify(){throw Error('not allowed');}});
 await assert.rejects(failed.observe(observation('o1',1)),/HTTP failure/);assert.equal(calls,3);
});
test('revisit binds an actually retrieved original identity, filtering model statements and future candidates',async()=>{
 const {memory}=store();let step=0,searches=0;
 const agent=new SeparatedSpatialAgent(memory,{async perceive(i){return {...perception(i.current.id),retrievalQueries:i.current.id==='o3'?['door']:[]};},async identify(i){
  step++;
  if(step===1)return action(i.current.id,i.references,'establish_candidate');
  if(step===2)return action(i.current.id,i.references,'establish_candidate','different');
  assert.deepEqual(i.references.map(r=>r.id),['o2','o1']);assert.ok(!JSON.stringify(i).includes('runtime-'));
  return {...action(i.current.id,i.references,'revisit'),referenceId:'o1',comparisons:i.references.map(r=>({referenceId:r.id,relation:r.id==='o1'?'same':'different',evidence:'verified original boundary arrangement'}))};
 }});
 const first=await agent.observe(observation('o1',1)),second=await agent.observe(observation('o2',2));
 memory.search=async()=>{searches++;return [{id:'o1',atMs:1,placeId:'runtime-1',reason:'candidate only',kind:'observation'},{id:'model-output:1',atMs:1,placeId:'fake',reason:'poison',kind:'model-statement'},{id:'future',atMs:99,placeId:'future',reason:'future'}];};
 const third=await agent.observe(observation('o3',3));assert.equal(searches,1);assert.equal(third.judgment.placeId,first.judgment.placeId);assert.notEqual(third.segmentId,second.segmentId);assert.equal(third.decision.action,'revisit');
});
test('uncertain older anchor is not a positive contradiction; local-only reuse remains visibly provisional',async()=>{
 const {memory}=store();let step=0;
 const agent=new SeparatedSpatialAgent(memory,{async perceive(i){return perception(i.current.id);},async identify(i){step++;const answer=action(i.current.id,i.references,step===1?'establish_candidate':'continue');if(step===3)answer.comparisons[1]!.relation='uncertain';return answer;}});
 await agent.observe(observation('o1',1));await agent.observe(observation('o2',2));const third=await agent.observe(observation('o3',3));
 assert.equal(third.judgment.placeId,'runtime-1');assert.equal(third.identitySupport,'single-reference');assert.deepEqual(third.supportingReferenceIds,['o2']);assert.deepEqual(third.unconfirmedReferenceIds,['o1']);assert.equal(third.status,'candidate-interpretation-not-ground-truth');
});
test('positive older-anchor contradiction still blocks commit and receives bounded feedback',async()=>{
 const {memory,assignments}=store();let step=0,rejected=0;
 const agent=new SeparatedSpatialAgent(memory,{async perceive(i){return perception(i.current.id);},async identify(i){
  step++;const answer=action(i.current.id,i.references,step===1?'establish_candidate':'continue');
  if(i.current.id==='o3'){rejected++;answer.comparisons[1]!.relation='different';if(rejected===2)assert.match(i.feedback!,/positive layout contradiction/);}
  return answer;
 }});
 await agent.observe(observation('o1',1));await agent.observe(observation('o2',2));await assert.rejects(agent.observe(observation('o3',3)),/positive layout contradiction/);assert.equal(rejected,2);assert.equal(assignments.has('o3'),false);
});

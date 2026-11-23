import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouteExperienceExperiment,coarseMotion,type RouteObservation} from './route-experience-experiment.js';
const obs=(id:string,t:number,x=0,yaw=0):RouteObservation=>({id,atMs:t,images:[{id,direction:'front',path:'fixture.png',sha256:'fixture'}],pose:{x,y:0,yaw,frameId:'local',source:'ideal_pose_experiment'}});
const proposal=(id:string)=>({decision:'new',placeId:null,description:'可见门口',sourceIds:[id]});
test('ideal pose becomes coarse camera motion, wrapped yaw and frame mismatch are explicit',()=>{
 const a=obs('a',0).pose,b=obs('b',1,3,Math.PI/2).pose;
 assert.equal(coarseMotion(a,b).turn,'left');assert.equal(coarseMotion(a,b).translation,'medium');
 assert.equal(coarseMotion({...a,yaw:Math.PI-.1},{...a,yaw:-Math.PI+.1}).turn,'straight');
 assert.throws(()=>coarseMotion(a,{...b,frameId:'other'}),/frame/);
});
test('sequence survives restart; exact poses never enter model requests; route is grounded forward evidence',async()=>{
 const agent=new RouteExperienceExperiment(async r=>{
  const d=r.data as any;assert.ok(!JSON.stringify(r).includes('123.456'));assert.ok(!JSON.stringify(d).includes('frameId'));
  return proposal(d.current.id);
 });
 await agent.observe(obs('a',0,123.456));await agent.observe(obs('b',1,124));
 const restored=new RouteExperienceExperiment(async()=>({description:'从门口到下一个门口；当前朝向和通行情况需确认。',sourceIds:['a','b']}),agent.snapshot());
 assert.equal((await restored.describeRoute('a','b')).status,'historical-route-unverified-for-live-use');
 assert.throws(()=>restored.routeRequest('b','a'),/forward/);
 assert.deepEqual(restored.snapshot(),agent.snapshot());
});
test('invalid references and future aliases fail without modifying memory; duplicate time rejected',async()=>{
 let bad=false;const a=new RouteExperienceExperiment(async r=>bad?{...proposal('b'),sourceIds:['b','future']}:proposal((r.data as any).current.id));
 await a.observe(obs('a',0));const before=a.snapshot();bad=true;
 await assert.rejects(a.observe(obs('b',1)),/evidence/);assert.deepEqual(a.snapshot(),before);
 await assert.rejects(a.observe(obs('a',0)),/Duplicate/);
});
test('candidate identity needs cited historical image, uncertain blocks route, context is bounded',async()=>{
 let mode='new';const a=new RouteExperienceExperiment(async r=>mode==='same'?{decision:'same',placeId:'place-0',description:'门口',sourceIds:[(r.data as any).current.id]}:mode==='uncertain'?{...proposal((r.data as any).current.id),decision:'uncertain'}:proposal((r.data as any).current.id));
 await a.observe(obs('a',0));mode='same';await assert.rejects(a.observe(obs('b',1)),/evidence/);
 mode='uncertain';await a.observe(obs('b',1));assert.throws(()=>a.routeRequest('a','b'),/unresolved/);
 mode='new';for(let i=2;i<12;i++)await a.observe(obs(String(i),i));
 const r=a.observationRequest(obs('last',12));assert.ok(r.images.length<=12);assert.ok((r.data as any).history.length<=3);
});

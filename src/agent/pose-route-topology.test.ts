import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PoseRouteTopology,routeTurn,type RoutePose,type PlaceVisit} from './pose-route-topology.js';
import {RouteDescriptionAgent} from './route-description-agent.js';
import {FixedPoseRouteAssistant} from './fixed-pose-route-assistant.js';
import {FixedGroupSpatialAgent} from './spatial-fixed-group-agent.js';
const pose=(atMs:number,x:number,y=0):RoutePose=>({atMs,x,y,z:0,yawDeg:0,frameId:'NED',recordingId:'r',source:'ideal-pose-experiment'});
const visit=(id:string,atMs:number,placeId:string|null):PlaceVisit=>({id,atMs,placeId,name:placeId,images:[{id,direction:'front',path:'fixture.png',sha256:'fixture'}]});
function graph(){const g=new PoseRouteTopology();for(let i=0;i<=20;i++)g.ingestPose(pose(i*100,Math.min(i,10),Math.max(0,i-10)));return g;}
test('directed edges retain full dense pose, reverse order preserves original camera yaw',()=>{
 const g=graph();g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('b',2000,'B'));
 const e=g.edges()[0]!,f=g.traversal(e.id,'forward'),r=g.traversal(e.id,'reverse');
 assert.equal(e.samples.length,21);assert.equal(e.distanceM,20);assert.deepEqual(r.samples,[...f.samples].reverse());
 assert.equal(r.samples[0]!.yawDeg,0);assert.equal(f.movements[1]!.turn,'right');assert.equal(r.movements[1]!.turn,'left');
 assert.equal(g.plan('b','A')[0]!.direction,'reverse');
});
test('intra-place movement is retained, and gap/coordinate frame changes cannot create a route',()=>{
 const g=graph();g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('a2',1000,'A'));g.recordVisit(visit('b',2000,'B'));
 assert.equal(g.edges()[0]!.kind,'within-place');assert.equal(g.plan('a','B').length,2);
 const gap=new PoseRouteTopology();gap.ingestPose(pose(0,0));gap.ingestPose(pose(1000,10));gap.recordVisit(visit('a',0,'A'));gap.recordVisit(visit('b',1000,'B'));assert.equal(gap.edges().length,0);
 const frame=new PoseRouteTopology();frame.ingestPose(pose(0,0));frame.ingestPose({...pose(100,1),frameId:'different'});frame.recordVisit(visit('a',0,'A'));frame.recordVisit(visit('b',100,'B'));assert.equal(frame.edges().length,0);
});
test('unknown identity does not erase continuous measured traversal, but is never a new place',()=>{
 const g=graph();g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('u',1000,null));g.recordVisit(visit('b',2000,'B'));
 assert.equal(g.nodes().length,2);assert.equal(g.edges().length,1);assert.equal(g.edges()[0]!.samples.length,21);
});
test('one-way overrides reversibility; identical place label never teleports between distant visits',()=>{
 const g=graph();g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('b',1000,'B'));g.recordVisit(visit('a2',2000,'A'));
 g.setReversible(g.edges()[1]!.id,false);
 assert.throws(()=>g.traversal(g.edges()[1]!.id,'reverse'),/one-way/);
 assert.throws(()=>g.plan('a2','B'),/No continuous/);
});
test('joined route uses preceding travel bearing, not the next recorded camera orientation',()=>{
 const g=new PoseRouteTopology();for(let i=0;i<=20;i++)g.ingestPose(pose(i*100,-Math.max(0,i-10),Math.min(i,10)));
 g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('b',1000,'B'));g.recordVisit(visit('c',2000,'C'));
 const route=g.plan('a','C');assert.equal(route[1]!.startHeadingDeg,90);assert.equal(route[1]!.movements[0]!.turn,'right');
 assert.equal(g.traversal(g.edges()[1]!.id,'forward').movements[0]!.turn,'reverse');
 assert.equal(routeTurn(359,1),'straight');assert.equal(routeTurn(0,90),'right');assert.equal(routeTurn(90,0),'left');
});
test('description agent gets computed motion, never raw coordinate arrays; cache survives restore',async()=>{
 const g=graph();g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('b',2000,'B'));let calls=0;
 const narrator=new RouteDescriptionAgent(async r=>{calls++;const d=r.data as any;assert.ok(!JSON.stringify(d).includes('samples'));assert.ok(!JSON.stringify(d).includes('yawDeg'));return {segments:d.movements.map((m:any)=>({index:m.index,turn:m.turn,text:'沿记录中的这段路线前行。',sourceIds:['a','b']})),uncertainties:['当前通行未确认。']};});
 const step=g.traversal(g.edges()[0]!.id,'forward');await narrator.describe(g,step);await narrator.describe(g,step);assert.equal(calls,1);
 const restored=PoseRouteTopology.restore(g.snapshot());assert.deepEqual(restored.snapshot(),g.snapshot());await narrator.describe(restored,step);assert.equal(calls,1);
 assert.equal(restored.getDescription(restored.traversal(g.edges()[0]!.id,'reverse')),null);
});
test('incorrect turn/text/citation never commits an edge description',async()=>{
 for(const mode of ['turn','text','citation']){
  const g=graph();g.recordVisit(visit('a',0,'A'));g.recordVisit(visit('b',1000,'B'));const step=g.traversal(g.edges()[0]!.id,'forward');
  const agent=new RouteDescriptionAgent(async()=>({segments:[{index:0,turn:mode==='turn'?'left':'straight',text:mode==='text'?'右转后行进':'沿记录前行',sourceIds:mode==='citation'?['future']:['a']}],uncertainties:[]}));
  await assert.rejects(agent.describe(g,step));assert.equal(g.getDescription(step),null);
 }
});
test('composition passes only ID/time into unchanged fixed recognizer',async()=>{
 const g=graph();let seen:unknown;
 const fixed=new FixedGroupSpatialAgent({async perceive(v){seen=v;return {};},async createScope(v){return {coherent:true,scope:{name:'visible area',definition:'visible bounded area',boundaryRules:['visible edge'],sourceIds:[v.id]}};},async checkPage(){throw Error('not needed');}});
 const agent=new FixedPoseRouteAssistant(fixed,g,new RouteDescriptionAgent(async()=>{throw Error('not needed');}));
 await agent.observe({id:'a',atMs:0,images:visit('a',0,'A').images});assert.deepEqual(seen,{id:'a',atMs:0});assert.equal(g.nodes().length,1);
});
test('duplicate visits and malformed snapshots fail without rewriting originals',()=>{
 const g=graph();g.recordVisit(visit('a',0,'A'));const before=g.snapshot();assert.throws(()=>g.recordVisit(visit('a',1000,'B')));assert.deepEqual(g.snapshot(),before);
 assert.throws(()=>PoseRouteTopology.restore({...before,schema:'invalid'} as any));
});

import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PoseRouteTopology,type RoutePose,type PlaceVisit} from '../agent/pose-route-topology.js';
import {RouteDescriptionAgent} from '../agent/route-description-agent.js';
import {spatialJsonVlm} from '../agent/spatial-json-vlm.js';

const [dataset,output,...flags]=process.argv.slice(2);
if(!dataset||!output||flags.some(f=>f!=='--confirm-paid')||flags.length>1)throw Error('Usage: fixed-pose-routes DATASET NEW-OUTPUT [--confirm-paid]');
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const raw=await readFile(join(dataset,'input.json'),'utf8'),goldRaw=await readFile(join(dataset,'gold.json'),'utf8'),frozen=JSON.parse(await readFile(join(dataset,'frozen.json'),'utf8'));
if(sha(raw)!==frozen.inputSha256||sha(goldRaw)!==frozen.goldSha256)throw Error('Frozen sidecar dataset changed');
const input=JSON.parse(raw) as {schema:string;poses:RoutePose[];visits:PlaceVisit[]};
if(input.schema!=='fixed-pose-route-input-v1')throw Error('Wrong sidecar schema');
await mkdir(output,{recursive:false});
const sourceHashes:Record<string,string>={};for(const file of ['src/agent/pose-route-topology.ts','src/agent/route-description-agent.ts','src/agent/fixed-pose-route-assistant.ts','src/evaluation/fixed-pose-routes.ts','src/agent/spatial-json-vlm.ts','dist/current/agent/pose-route-topology.js','dist/current/agent/route-description-agent.js','dist/current/agent/spatial-json-vlm.js','dist/current/evaluation/fixed-pose-routes.js'])sourceHashes[file]=sha(await readFile(file));
await writeFile(join(output,'manifest.json'),JSON.stringify({inputSha256:sha(raw),goldSha256:sha(goldRaw),sourceHashes,placeRecognition:'existing-fixed-v2-output-no-pose-input-no-new-localization-score',paidNarration:flags.length===1,maxCalls:4,maxEstimatedUSD:.1,reversePolicy:'allowed-unless-one-way',scope:'partial-fixed-run-sidecar-not-completed-full-trajectory'},null,2));
const graph=new PoseRouteTopology();for(const p of input.poses)graph.ingestPose(p);for(const v of input.visits)graph.recordVisit(v);
await writeFile(join(output,'graph-before-narration.json'),JSON.stringify(graph.snapshot(),null,2));
const restored=PoseRouteTopology.restore(JSON.parse(await readFile(join(output,'graph-before-narration.json'),'utf8')));
const gold=JSON.parse(goldRaw) as {tests:Array<{id:string;edgeId:string;direction:'forward'|'reverse';from:string;to:string;fromVisitId:string;toVisitId:string;sampleAtMs:number[];distanceM:number}>};
const details=gold.tests.map(test=>{
 try{const step=restored.traversal(test.edgeId,test.direction),distance=step.samples.slice(1).reduce((s,p,i)=>{const a=step.samples[i]!;return s+Math.hypot(a.x-p.x,a.y-p.y,a.z-p.z);},0);
 const fields={from:step.from===test.from,to:step.to===test.to,fromVisitId:step.fromVisitId===test.fromVisitId,toVisitId:step.toVisitId===test.toVisitId,samples:JSON.stringify(step.samples.map(p=>p.atMs))===JSON.stringify(test.sampleAtMs),distance:Math.abs(distance-test.distanceM)<1e-6};
 return {id:test.id,correct:Object.values(fields).every(Boolean),fields};
 }catch(error){return {id:test.id,correct:false,error:String(error)};}
});
const plans=[];
for(const from of input.visits.filter(v=>v.placeId!==null))for(const goal of restored.nodes().filter(n=>n.id!==from.placeId)){
 try{
  const route=restored.plan(from.id,goal.id);let current=input.poses.find(p=>p.atMs===from.atMs)!;
  let correct=route.length>0&&route[0]!.from===from.placeId&&route.at(-1)!.to===goal.id;
  for(const step of route){const first=step.samples[0]!;correct&&=first.frameId===current.frameId&&first.recordingId===current.recordingId&&Math.hypot(first.x-current.x,first.y-current.y,first.z-current.z)<=restored.joinToleranceM;current=step.samples.at(-1)!;}
  plans.push({fromVisitId:from.id,goalPlaceId:goal.id,correct,steps:route.map(s=>({edgeId:s.edgeId,direction:s.direction,startHeadingDeg:s.startHeadingDeg,movements:s.movements}))});
 }catch(error){plans.push({fromVisitId:from.id,goalPlaceId:goal.id,correct:false,error:String(error)});}
}
const report:any={schema:'fixed-pose-route-score-v1',source:frozen,graph:{nodes:restored.nodes().length,betweenPlaceEdges:restored.edges().filter(e=>e.kind==='between-place').length,withinPlaceSegments:restored.edges().filter(e=>e.kind==='within-place').length,poses:input.poses.length,visits:input.visits.length},geometry:{correct:details.filter(d=>d.correct).length,total:details.length,details},routeContinuity:{correct:plans.filter(p=>p.correct).length,total:plans.length,details:plans},snapshotReload:'passed',narration:{status:flags.length?'pending':'not-run-no-paid-flag',cases:[]},limitations:['Fixed candidate identities not independently scored as semantic places.','Only original completed prefix included.','Geometry regression does not score landmark truth or human safety.','Default reversal is product policy, not proof of current traversability.']};
const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await save();
if(flags.length){
 const narrator=new RouteDescriptionAgent(spatialJsonVlm(join(output,'requests'),4,.1));
 // One actual between-place traversal, separately narrated forward and reverse.
 const edge=restored.edges().find(e=>e.kind==='between-place'&&restored.traversal(e.id,'forward').movements.length>0);
 if(!edge)throw Error('No between-place edge for narration');
 for(const direction of ['forward','reverse'] as const){
  const step=restored.traversal(edge.id,direction);const entry:any={edgeId:edge.id,direction,status:'pending'};report.narration.cases.push(entry);
  await writeFile(join(output,`narration-${direction}-input.json`),JSON.stringify(narrator.request(restored,step),null,2));
  try{entry.description=await narrator.describe(restored,step);entry.text=narrator.render(entry.description);entry.status='accepted-structural-constraints-only';}
  catch(error){entry.status='failed';entry.error=String(error);report.narration.status='stopped';await save();await writeFile(join(output,'graph.json'),JSON.stringify(restored.snapshot(),null,2));process.exitCode=1;break;}
  await writeFile(join(output,'graph.json'),JSON.stringify(restored.snapshot(),null,2));await save();
 }
 if(report.narration.status!=='stopped')report.narration.status='completed-not-semantic-accuracy';
 const reopened=PoseRouteTopology.restore(JSON.parse(await readFile(join(output,'graph.json'),'utf8')));report.narration.cachedAfterReload=reopened.snapshot().descriptions.length;
}
await save();
const text=['# 固定版＋位姿拓扑＋说明Agent',`节点 ${report.graph.nodes}；地点间边 ${report.graph.betweenPlaceEdges}；地点内轨迹 ${report.graph.withinPlaceSegments}。`,`正反向几何检查 ${report.geometry.correct}/${report.geometry.total}；路线连续性 ${report.routeContinuity.correct}/${report.routeContinuity.total}。`,`说明Agent状态：${report.narration.status}（不代表语言正确率）。`,...report.narration.cases.map((c:any)=>`\n## ${c.direction}\n${c.text??c.error}`),'\n仅历史机器人轨迹，非视障安全导航验收。'].join('\n\n');
await writeFile(join(output,'report.md'),text);
console.log(JSON.stringify({graph:report.graph,geometry:{correct:report.geometry.correct,total:report.geometry.total},routeContinuity:{correct:report.routeContinuity.correct,total:report.routeContinuity.total},narration:report.narration}));

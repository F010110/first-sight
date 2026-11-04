import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {createPiSpatialReasoner} from '../../assistant/spatial-memory/pi-reasoner.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';

const [inputArg,outArg,mode]=process.argv.slice(2);
if(!inputArg||!outArg||!['--offline','--confirm-paid'].includes(mode??''))throw Error('Usage: preflight-spatial-revisit-correction PUBLIC-INPUT NEW-OUTPUT --offline|--confirm-paid');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const source=JSON.parse(await readFile(inputArg,'utf8'));
const rows:Observation[]=[59,67,95].map(index=>{const r=source.observations[index];return {id:r.id,atMs:r.atMs,views:r.views.map((v:any)=>({...v,id:r.id}))};});
const [oldRow,,currentRow]=rows as [Observation,Observation,Observation];
const request=spatialJsonVlm(join(out,'requests'),8,.5,false,1600);
const injections:unknown[]=[],feedbackSeen:string[]=[];let stage=0,oldPlace:string|null=null,correctionCalls=0;
const reasoner=await createPiSpatialReasoner(join(out,'pi'),async input=>{
 const data=input.data as any,rt=data.runtimeContext,id=data.current.id;
 if(!rt)throw Error('Unexpected compaction in bounded correction preflight');
 const assessment={location:{status:'unknown',placeId:null,name:'待核对',reason:'当前身份尚待检查历史图',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[]};
 let output:any;
 if(id!==currentRow.id){
  output={tool:'memory_add',arguments:{assessment:{...assessment,location:{...assessment.location,status:'new',name:'故障预检地点-'+id,regionChangeEvidence:['预检控制：两组不同区域原图']}},notes:[]}};
 }else{
  oldPlace??=rt.revisit.candidates[0].placeId;
  const known={...assessment,location:{...assessment.location,status:'known',placeId:oldPlace,name:'故障预检旧地点',reason:'当前与历史原图支持重访'}};
  const feedback=JSON.stringify(rt.feedback??null);
  if(stage>0&&stage<=3){
   const field=stage===1?'location.sourceIds':stage===2?'location.sourceIds':'memory_inspect.ids';
   if(!feedback.includes(field))throw Error('Missing explicit latest error for '+field);
   feedbackSeen.push(feedback);
   if(stage===3)stage=4;
  }
  if(stage===0){stage++;output={tool:'memory_add',arguments:{assessment:known,notes:[]}};}
  else if(stage===1){stage++;output={tool:'memory_add',arguments:{assessment:{...known,location:{...known.location,sourceIds:[id,oldRow.id]}},notes:[]}};}
  else if(stage===2){stage++;output={tool:'memory_inspect',arguments:{assessment,ids:[source.observations[63].id]}};}
  else if(mode==='--offline'){
   correctionCalls++;
   if(!rt.inspectedIds.includes(oldRow.id))output={tool:'memory_inspect',arguments:{assessment,ids:[oldRow.id]}};
   else output={tool:'memory_add',arguments:{assessment:{...known,location:{...known.location,sourceIds:[id,oldRow.id]}},notes:[]}};
  }else{correctionCalls++;return request(input);}
 }
 injections.push({id,output,kind:mode==='--offline'&&stage===3&&id===currentRow.id?'scripted-correction':'fault-or-seed'});
 await writeFile(join(out,'injections.json'),JSON.stringify(injections,null,2));
 return {output,usage:{prompt_tokens:0,completion_tokens:0}};
});
const service=await SpatialMemoryService.create(out,{async perceive(){return {summary:'协议故障预检占位元数据，非视觉提取结果',details:['身份判断应以本轮实际原图为准']};}},
 {reasoner,revisitPolicy:'required',revisitMatcher:{async match(current,candidates){const c=candidates[0]!;return {ok:true,best:null,nearest:null,results:[{placeId:c.placeId,observationId:c.image.id,inliers:29,similarity:.8}]};}}});
let error:string|null=null,passed=false;
try{
 for(const row of rows){await service.observe(row);await service.finishInput();}
 const state=service.latest()!.state;
 passed=state.assessment.location.status==='known'&&state.assessment.location.placeId===oldPlace&&state.assessment.location.sourceIds.includes(oldRow.id)&&service.progress().places===2&&service.progress().visits===3&&feedbackSeen.length===3;
 if(!passed)throw Error('Final state did not commit a sourced revisit using the existing place and new visit');
}catch(e){error=String(e);}
finally{
 const result={passed,mode,stage,correctionCalls,feedbackSeen,progress:service.progress(),finalState:service.latest()?.state,error,note:'Synthetic seed judgments, candidate scores, and invalid calls are explicitly recorded with zero synthetic usage. Real mode sends only repair decisions to model; never automatically rewrites its arguments. Protocol test, not recognition accuracy evaluation.'};
 await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await service.close().catch(()=>{});
}
if(error)throw Error(error);

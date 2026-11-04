import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPiSpatialReasoner} from '../../assistant/spatial-memory/pi-reasoner.js';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';

const [inputArg,outArg,confirm]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: preflight-spatial-correction PUBLIC-INPUT NEW-OUTPUT --confirm-paid');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const source=JSON.parse(await readFile(inputArg,'utf8'));
const rows:Observation[]=[source.observations[0],source.observations[65]].map((r:any)=>({id:r.id,atMs:r.atMs,views:r.views.map((v:any)=>({...v,id:r.id}))}));
const request=spatialJsonVlm(join(out,'requests'),16,1,false,1600);
let phase=0,sawSourceFeedback=false,sawReferenceFeedback=false;
const injected:unknown[]=[];
const reasoner=await createPiSpatialReasoner(join(out,'pi'),async r=>{
 const data=r.data as any,rt=data.runtimeContext,id=data.current.id;
 if(data.role==='spatial-compaction')return request(r);
 const unknown={location:{status:'unknown',placeId:null,name:'未确定',reason:'先检查历史候选',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[]};
 let output:any;
 if(id===rows[0]!.id&&phase===0){phase++;output={tool:'memory_add',arguments:{assessment:{...unknown,location:{...unknown.location,status:'new',name:'预检地点',sourceIds:[id,'deliberately-undelivered-source']}}}};}
 else if(id===rows[1]!.id&&phase===1){phase++;output={tool:'memory_timeline',arguments:{assessment:unknown}};}
 else if(id===rows[1]!.id&&phase===2){phase++;output={tool:'memory_inspect',arguments:{ids:[rows[0]!.id],assessment:unknown}};}
 else if(id===rows[1]!.id&&phase===3){phase++;output={tool:'memory_add',arguments:{assessment:{...unknown,location:{...unknown.location,status:'new',name:'预检室内',regionChangeEvidence:['从站台到店铺室内']},relations:[{kind:'different-region',referenceId:rt.workingContext.recent[0].assessment.location.placeId,reason:'当前图与历史布局不同',sourceIds:[id,rows[0]!.id]}]}}};}
 if(output){injected.push({currentId:id,output});await writeFile(join(out,'injections.json'),JSON.stringify(injected,null,2));return {output,usage:{prompt_tokens:0,completion_tokens:0}};}
 const feedback=JSON.stringify(rt.feedback??null);
 if(id===rows[0]!.id&&feedback.includes('location.sourceIds'))sawSourceFeedback=true;
 if(id===rows[1]!.id&&feedback.includes('relations[0].referenceId'))sawReferenceFeedback=true;
 return request(r);
});
const service=await SpatialMemoryService.create(out,{async perceive(row){return {summary:'纠错协议预检：原图供空间Agent判断',details:['协议测试占位元数据，不是视觉提取事实；请以本轮实际原图为证据']};}},{reasoner});
let error:string|null=null;
try{
 for(const row of rows){await service.observe(row);await service.finishInput();}
 if(!sawSourceFeedback||!sawReferenceFeedback)throw Error('Injected field errors were not explicitly delivered to real model');
}catch(e){error=String(e);}
finally{
 const result={kind:'intentional-field-error-real-model-preflight',passed:!error&&service.progress().spatialStates===2,sawSourceFeedback,sawReferenceFeedback,progress:service.progress(),error,note:'Synthetic invalid tool calls are injected explicitly, with zero synthetic usage. Only subsequent correction calls use the real model. Not a spatial quality evaluation.'};
 await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await service.close().catch(()=>{});
}
if(error)throw Error(error);

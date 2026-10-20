import {appendFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import {SpatialContextLoop} from '../agent/spatial-context-loop.js';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';
import {spatialContextVlm} from '../agent/spatial-context-vlm.js';
import type {CapabilityResult,ObservationService} from './contracts.js';

/** Anti-corruption adapter: frozen spatial core remains unchanged and knows no UI. */
export class SpatialCapability implements ObservationService {
 private readonly memory:SpatialContextMemory;
 private readonly loop:SpatialContextLoop;
 private pending:SpatialObservation[]=[];
 private latest:SpatialObservation|undefined;
 private started=-Infinity;
 private skipPending=false;
 private failure:string|null=null;
 constructor(private readonly root:string,private readonly enabled:boolean,onLanguage?:(value:unknown)=>Promise<void>){
  this.memory=new SpatialContextMemory(join(root,'memory.sqlite'));
  const model=spatialContextVlm(join(root,'requests'),256,1,async(atMs,value)=>{await this.memory.writeOutput(atMs,value);try{const r=JSON.parse((value as {rawResponse:string}).rawResponse);const output=JSON.parse(r.choices[0].message.content);await onLanguage?.({atMs,output,status:'raw-model-output-not-validated'});}catch{this.loop.context.recordOutput(atMs,value);}});
  this.loop=new SpatialContextLoop(this.memory,model,16);
 }
 async observe(observation:SpatialObservation){
  this.assertHealthy();await this.settleSkipped();
  this.latest=structuredClone(observation);
  // Original observation persists even if inference is disabled or fails.
  await this.memory.writeObservation(observation);
  this.pending.push(structuredClone(observation));
  if(this.pending.length>120)throw Error('Spatial pending observation limit exceeded');
  if(this.enabled&&observation.atMs-this.pending[0]!.atMs>=10000&&observation.atMs-this.started>=5000){this.started=observation.atMs;await this.window(this.pending.splice(0,4));}
 }
 private async window(window:SpatialObservation[],question:string|null=null):Promise<CapabilityResult|undefined>{
  let result:Awaited<ReturnType<SpatialContextLoop['runWindow']>>;
  try{result=await this.loop.runWindow(window,question);}catch(error){this.failure=String(error);throw error;}
  await appendFile(join(this.root,'results.jsonl'),JSON.stringify({ids:window.map(o=>o.id),question,result})+'\n');
  if(result.status==='budget-exhausted'){this.failure='空间能力推理轮次耗尽';throw Error('空间能力推理轮次耗尽，未完成。');}
  if(result.status==='answered')return {text:result.answer,source:question?.startsWith('历史查询')?'historical':'visual',sourceIds:result.sourceIds,abstained:result.abstained};
  if(question)throw Error('空间能力没有形成最终回答');
 }
 async question(text:string,historical:boolean){
  this.assertHealthy();await this.settleSkipped();
  if(!this.enabled)throw Error('Model disabled');
  if(!this.latest)throw Error('本会话没有视觉记录。请先开始观察并导入图片。');
  // Flush old pending observations in order; never replace actual inspect with summaries.
  while(this.pending.length>4)await this.window(this.pending.splice(0,4));
  const window=this.pending.length?this.pending.splice(0,4):[this.latest];
  const prefix=historical?'历史查询：仅依据本会话实际原图记录回答；这些记录不是当前现场。':'图片问答：仅描述此批输入图片（可能是模拟器轨迹回放或手动导入），不声称正在实时看真实现场。';
  const question=`${prefix} 导入时间为主机时间，不是已验证拍摄时间。用户：${text}`;
  return (await this.window(window,question))!;
 }
 private assertHealthy(){if(this.failure)throw Error(`空间能力上次运行失败，已熔断以保留现场；请新建应用会话，不自动恢复Context。${this.failure}`);}
 private async settleSkipped(){
  if(!this.skipPending)return;
  this.skipPending=false;
  // No model call; an unknown assignment prevents a cancelled prefix from
  // blocking all future commits. This is not a location judgment or a fact.
  for(const row of this.pending.splice(0)){
   await this.memory.writeObservation(row);
   await this.memory.writeAssessment({observationId:row.id,atMs:row.atMs,placeId:null,reason:'System: observation analysis cancelled; spatial identity unknown.',sourceIds:[row.id]});
  }
  this.started=-Infinity;
 }
 discardPending(){this.skipPending=true;}
 close(){this.memory.close();}
 static async create(root:string,enabled:boolean,onLanguage?:(value:unknown)=>Promise<void>){await mkdir(root,{recursive:true});return new SpatialCapability(root,enabled,onLanguage);}
}

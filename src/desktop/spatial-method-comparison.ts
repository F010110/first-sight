import {readFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
/** Trusted local manifest only. No request-provided filesystem paths or inference. */
export async function loadSpatialMethodComparison(path:string){
 const config=JSON.parse(await readFile(path,'utf8'));
 if(config.schema!=='spatial-method-comparison-v1'||!config.sample?.id||!Array.isArray(config.methods)||config.methods.length<2||config.methods.length>6||new Set(config.methods.map((m:any)=>m.id)).size!==config.methods.length)throw Error('Invalid comparison manifest');
 let sourceHash:string|null=null;
 const methods=[];
 for(const method of config.methods){
  if(!method.id||!method.label||typeof method.root!=='string')throw Error('Invalid comparison method');
  const inputRaw=await readFile(join(method.root,'public-input.json'));
  const frozen=JSON.parse(await readFile(join(method.root,'frozen.json'),'utf8'));
  const hash=createHash('sha256').update(inputRaw).digest('hex');
  if(hash!==frozen.inputSha256||sourceHash&&sourceHash!==hash)throw Error('Comparison runs must bind identical source inputs');sourceHash=hash;
  const input=JSON.parse(inputRaw.toString());
  if(config.sample.episodeNumber!==undefined&&input.observations.some((o:any)=>o.scene!==`campus-episode-${config.sample.episodeNumber}`)||config.sample.sourceScheduleStartMs!==undefined&&input.observations[0]?.atMs!==config.sample.sourceScheduleStartMs)throw Error('Comparison sample clock does not match source');
  const observations=new Map<string,any>(input.observations.map((o:any)=>[o.id,o]));
  const raw=await readFile(join(method.root,'events.jsonl'),'utf8');
  const rows=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  let last=-Infinity;
  const seen=new Set<string>();
  const events=rows.map(({scene,result:r}:any)=>{
   const source=observations.get(r.id);
   if(!source||source.scene!==scene||source.atMs!==r.atMs||r.atMs<=last||seen.has(r.id))throw Error('Invalid or noncausal saved comparison event');last=r.atMs;seen.add(r.id);
   const index=r.groups.findIndex((g:any)=>g.id===r.placeId),group=r.groups[index];
   if(r.placeId!==null&&!group)throw Error('Saved identity has no scope');
   return {observationId:r.id,atMs:r.atMs,episodeNumber:Number(scene.match(/^campus-episode-(\d+)$/)?.[1]??0),placeId:r.placeId,placeKey:group?`P${index+1}`:null,name:group?.scope.name??'地点待定',definition:group?.scope.definition??null,action:r.action,uncertainties:r.perception?.uncertainties??[]};
  });
  const predictions=JSON.parse(await readFile(join(method.root,'predictions.json'),'utf8'));
  const usage=JSON.parse(await readFile(join(method.root,'requests/usage.json'),'utf8'));
  methods.push({id:method.id,label:method.label,description:method.description??'',runId:basename(method.root),events,provenance:{inputSha256:hash,eventsSha256:createHash('sha256').update(raw).digest('hex')},summary:{planned:input.observations.length,completed:events.length,unknown:events.filter(e=>e.placeId===null).length,places:new Set(events.map(e=>e.placeId).filter(Boolean)).size,failed:predictions.predictions.filter((p:any)=>p.status==='failed').length,pending:predictions.predictions.filter((p:any)=>p.status==='pending').length,calls:usage.calls,estimatedUSD:usage.estimatedUSD}});
 }
 return {schema:config.schema,sample:config.sample,methods,readOnly:true,note:'离线已保存结果，按观察时间对齐；不是实时推理延迟。地点编号仅在各方法内有效，不能按编号跨方法判同地。不同名称也不一定代表不同区域。'};
}

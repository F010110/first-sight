import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {FixedGroupSpatialAgent,fixedGroupPagePrompt} from '../agent/spatial-fixed-group-agent.js';
import {placeScopePrompt,parsePlaceScope} from '../agent/spatial-place-contract.js';
import {spatialJsonVlm,type SpatialJsonImage} from '../agent/spatial-json-vlm.js';
import {groundFirstSpatialPrompt} from '../agent/spatial-ground-first.js';
import {parseSpatialPerception} from '../agent/spatial-separated-protocol.js';
// Public replay input only: never load evaluation labels or expected group membership.
const inputPath=process.argv[2];
if(!inputPath||!process.argv.includes('--confirm-paid'))throw Error('Usage: run-spatial-fixed-evaluation PUBLIC-input.json --confirm-paid; max 128 calls, estimated USD0.50');
const inputRaw=await readFile(inputPath),input=JSON.parse(inputRaw.toString());
if(Object.keys(input).some(k=>!['schema','observations'].includes(k))||!Array.isArray(input.observations)||!input.observations.length)throw Error('Public input must contain only schema/observations, never labels');
type Row={id:string;scene:string;atMs:number;views:Array<{direction:string;path:string;sha256:string}>};
const rows=input.observations as Row[],seen=new Set<string>(),last=new Map<string,number>();
const groundFirst=process.argv.includes('--ground-first');
for(const r of rows){if(Object.keys(r).some(k=>!['id','scene','atMs','views'].includes(k))||!r.id||seen.has(r.id)||!r.scene||!Number.isFinite(r.atMs)||r.atMs<=(last.get(r.scene)??-Infinity)||!Array.isArray(r.views)||r.views.length!==3||new Set(r.views.map(v=>v.direction)).size!==3||r.views.some(v=>!['front','left','right'].includes(v.direction)||!/^[a-f0-9]{64}$/.test(v.sha256)))throw Error('Invalid causal public replay row');seen.add(r.id);last.set(r.scene,r.atMs);}
const root=resolve('run/spatial-fixed-evaluation',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});console.log(root);
const sourceFiles=['src/desktop/run-spatial-fixed-evaluation.ts','src/agent/spatial-fixed-group-agent.ts','src/agent/spatial-place-contract.ts','src/agent/spatial-json-vlm.ts','src/agent/spatial-ground-first.ts','src/agent/spatial-separated-protocol.ts'];
await writeFile(join(root,'frozen.json'),JSON.stringify({schema:'spatial-fixed-online-v1',inputSha256:createHash('sha256').update(inputRaw).digest('hex'),sourceHashes:Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),model:'qwen3.8-flash',enableThinking:false,maxCalls:128,maxEstimatedUSD:.5,scope:'Empty memory per scene, no seed labels, every candidate group and all member originals checked. No paid automatic resume or splice.'},null,2));
await writeFile(join(root,'strategy.json'),JSON.stringify({groundFirst,scope:'Explicit experimental opt-in; not default frontend memory'}));
await writeFile(join(root,'public-input.json'),inputRaw);
const byId=new Map(rows.map(r=>[r.id,r])),request=spatialJsonVlm(join(root,'requests'),128,.5);
const images=(ids:string[],current:Row):SpatialJsonImage[]=>ids.flatMap(id=>{const r=byId.get(id);if(!r||r.scene!==current.scene||r.atMs>current.atMs||id!==current.id&&r.atMs>=current.atMs)throw Error('Cross-scene/future image blocked');return r.views.map(v=>({id,direction:v.direction,path:v.path,sha256:v.sha256}));});
const agents=new Map<string,FixedGroupSpatialAgent>();let error:string|null=null;const predictions:Array<{id:string;placeId:string|null;status:'completed'|'failed'|'pending'}>=rows.map(r=>({id:r.id,placeId:null,status:'pending'}));
for(const [index,row] of rows.entries()){
 try{
  let agent=agents.get(row.scene);
  if(!agent){agent=new FixedGroupSpatialAgent({
   ...groundFirst?{perceive:async(current:{id:string;atMs:number})=>parseSpatialPerception(await request({phase:'perception',prompt:groundFirstSpatialPrompt,data:{current},images:images([current.id],byId.get(current.id)!)}),current.id)}:{},
   createScope:async(current,perception)=>{
    let feedback:string|undefined;
    for(let attempt=0;attempt<2;attempt++){
     const raw=await request({phase:'identity',prompt:placeScopePrompt+` 本次只有一张观察的三视图，SEED即CURRENT。scope.sourceIds必须准确为${JSON.stringify([current.id])}。示例内字段说明必须替换为实际图像描述，不得照抄模板。`+' 不根据废旧外观推断废弃、地下或建筑用途。只命名可见区域，范围不足可coherent=false。若有独立当前perception，应结合原图核对，不添加其中没有证据的第二面墙或隔离关系。',data:{current,...perception===undefined?{}:{perception},...feedback?{feedback}:{}},images:images([current.id],byId.get(current.id)!)});
     try{const value=raw as any;if(!value||typeof value.coherent!=='boolean')throw Error('coherent must be boolean');if(value.coherent)parsePlaceScope(value.scope,[current]);return value;}
     catch(error){if(attempt===1)throw error;feedback=String(error);}
    }
    throw Error('Unreachable scope repair');
   },
   checkPage:async data=>request({phase:'identity',prompt:fixedGroupPagePrompt(data.version,data.pageIndex),data,images:images([data.current.id,...data.memberIds],byId.get(data.current.id)!)})
  });agents.set(row.scene,agent);}
  const result=await agent.observe({id:row.id,atMs:row.atMs});predictions[index]={id:row.id,placeId:result.placeId,status:'completed'};
  await appendFile(join(root,'events.jsonl'),JSON.stringify({scene:row.scene,result})+'\n');
 }catch(e){error=String(e);predictions[index]={id:row.id,placeId:null,status:'failed'};await writeFile(join(root,'stopped.json'),JSON.stringify({id:row.id,error}));break;}
 finally{await writeFile(join(root,'predictions.json'),JSON.stringify({runId:root,predictions},null,2));}
}
console.log(JSON.stringify({root,error,completed:predictions.filter(p=>p.status==='completed').length,total:rows.length}));

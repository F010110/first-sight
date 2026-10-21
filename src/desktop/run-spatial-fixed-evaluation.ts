import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {FixedGroupSpatialAgent,fixedGroupPagePrompt} from '../agent/spatial-fixed-group-agent.js';
import {parsePlaceScope} from '../agent/spatial-place-contract.js';
import {fixedScopeCreationPrompt} from '../agent/spatial-fixed-prompts.js';
import {spatialJsonVlm,type SpatialJsonImage} from '../agent/spatial-json-vlm.js';
import {groundFirstSpatialPrompt} from '../agent/spatial-ground-first.js';
import {parseSpatialPerception} from '../agent/spatial-separated-protocol.js';
// Public replay input only: never load evaluation labels or expected group membership.
const inputPath=process.argv[2];
if(!inputPath||!process.argv.includes('--confirm-paid'))throw Error('Usage: run-spatial-fixed-evaluation PUBLIC-input.json --confirm-paid; max 128 calls, estimated USD0.50');
const callFlag=process.argv.find(arg=>arg.startsWith('--max-calls='));
const maxCalls=callFlag?Number(callFlag.slice('--max-calls='.length)):128;
if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>256)throw Error('Experimental call limit must be an integer from 1 to 256; cost cap remains USD0.50');
const inputRaw=await readFile(inputPath),input=JSON.parse(inputRaw.toString());
if(Object.keys(input).some(k=>!['schema','observations'].includes(k))||!Array.isArray(input.observations)||!input.observations.length)throw Error('Public input must contain only schema/observations, never labels');
type Row={id:string;scene:string;atMs:number;views:Array<{direction:string;path:string;sha256:string}>};
const rows=input.observations as Row[],seen=new Set<string>(),last=new Map<string,number>();
const groundFirst=process.argv.includes('--ground-first');
const comparative=process.argv.includes('--comparative-resolution');
const regionScale=process.argv.includes('--continuous-region-scope');
const scaleInstruction=' 本轮区域粒度为一个具体连续物理空间，不是每件家具前的局部站位：同一房间内转向、从一种家具走向另一种家具、开放空间内更换功能角落通常仍属同区，不能只因换了近处物体或功能名就拆分。需要原图可见的实墙/门洞空间隔断、围栏两侧等正面区域边界依据。反过来，隔门可见的物体和同款地板不能证明属于同一房间；不知道完整边界时说明限制，不补画看不见的连通或隔断。固定范围不能锁死拍摄朝向或仅仅距某个物体的远近。';
for(const r of rows){if(Object.keys(r).some(k=>!['id','scene','atMs','views'].includes(k))||!r.id||seen.has(r.id)||!r.scene||!Number.isFinite(r.atMs)||r.atMs<=(last.get(r.scene)??-Infinity)||!Array.isArray(r.views)||r.views.length!==3||new Set(r.views.map(v=>v.direction)).size!==3||r.views.some(v=>!['front','left','right'].includes(v.direction)||!/^[a-f0-9]{64}$/.test(v.sha256)))throw Error('Invalid causal public replay row');seen.add(r.id);last.set(r.scene,r.atMs);}
const root=resolve('run/spatial-fixed-evaluation',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});console.log(root);
const sourceFiles=['src/desktop/run-spatial-fixed-evaluation.ts','src/agent/spatial-fixed-group-agent.ts','src/agent/spatial-place-contract.ts','src/agent/spatial-json-vlm.ts','src/agent/spatial-ground-first.ts','src/agent/spatial-separated-protocol.ts','src/agent/spatial-fixed-prompts.ts'];
await writeFile(join(root,'frozen.json'),JSON.stringify({schema:'spatial-fixed-online-v1',inputSha256:createHash('sha256').update(inputRaw).digest('hex'),sourceHashes:Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),model:'qwen3.8-flash',enableThinking:false,maxCalls,maxEstimatedUSD:.5,scope:'Empty memory per scene, no seed labels, every candidate group and all member originals checked. No paid automatic resume or splice.'},null,2));
await writeFile(join(root,'strategy.json'),JSON.stringify({groundFirst,comparative,regionScale,scope:'Explicit experimental opt-in; not default frontend memory'}));
await writeFile(join(root,'public-input.json'),inputRaw);
const byId=new Map(rows.map(r=>[r.id,r])),request=spatialJsonVlm(join(root,'requests'),maxCalls,.5);
const images=(ids:string[],current:Row):SpatialJsonImage[]=>ids.flatMap(id=>{const r=byId.get(id);if(!r||r.scene!==current.scene||r.atMs>current.atMs||id!==current.id&&r.atMs>=current.atMs)throw Error('Cross-scene/future image blocked');return r.views.map(v=>({id,direction:v.direction,path:v.path,sha256:v.sha256}));});
const agents=new Map<string,FixedGroupSpatialAgent>();let error:string|null=null;const predictions:Array<{id:string;placeId:string|null;status:'completed'|'failed'|'pending'}>=rows.map(r=>({id:r.id,placeId:null,status:'pending'}));
for(const [index,row] of rows.entries()){
 try{
  let agent=agents.get(row.scene);
  if(!agent){agent=new FixedGroupSpatialAgent({
   ...groundFirst?{perceive:async(current:{id:string;atMs:number})=>{
    let feedback:string|undefined;
    for(let attempt=0;attempt<2;attempt++){
     const raw=await request({phase:'perception',prompt:groundFirstSpatialPrompt,data:{current,...feedback?{feedback}:{}},images:images([current.id],byId.get(current.id)!)});
     try{return parseSpatialPerception(raw,current.id);}catch(error){if(attempt===1)throw error;feedback=String(error)+' Return ALL required fields including observationId, region, clearRegion, layoutEvidence, uncertainties, retrievalQueries, sourceIds; do not return layoutEvidence alone.';}
    }
    throw Error('Unreachable perception repair');
   }}:{},
   createScope:async(current,perception)=>{
    let feedback:string|undefined;
    for(let attempt=0;attempt<2;attempt++){
     const raw=await request({phase:'identity',prompt:fixedScopeCreationPrompt(current.id)+(regionScale?scaleInstruction:''),data:{current,...perception===undefined?{}:{perception},...feedback?{feedback}:{}},images:images([current.id],byId.get(current.id)!)});
     try{const value=raw as any;if(!value||typeof value.coherent!=='boolean')throw Error('coherent must be boolean');if(value.coherent)parsePlaceScope(value.scope,[current]);return value;}
     catch(error){if(attempt===1)throw error;feedback=String(error);}
    }
    throw Error('Unreachable scope repair');
   },
   checkPage:async data=>request({phase:'identity',prompt:fixedGroupPagePrompt(data.version,data.pageIndex)+(regionScale?scaleInstruction:''),data,images:images([data.current.id,...data.memberIds],byId.get(data.current.id)!)}),
   ...comparative?{disambiguate:async(data:Parameters<NonNullable<import('../agent/spatial-fixed-group-agent.js').FixedGroupModels['disambiguate']>>[0])=>{
    const ids=[...new Set([data.current.id,...data.groups.flatMap(g=>g.members.map(m=>m.id))])];
    if(ids.length>4)return {selectedGroupId:null,groupChecks:data.groups.map(g=>({groupId:g.id,support:'uncertain',evidence:'Comparative original-image request exceeds 12-image cap; no references silently omitted'})),sourceIds:ids};
    return request({phase:'identity',prompt:'当前图对多个固定地点组分别得到了可兼容结果。现在把所有候选的全部成员原图一起对照，区分同实例布局和仅共享装修；不能按时间最近、名字相似或共同瓷砖/墙裙选组，不能改写任何组的名称或范围，也不能合并候选。逐候选核对当前图实际所在区域、独特设施及边界；图中可见同一长椅/柜体等布局时才能instance-supported。若两个候选都有实质实例支持、物理范围重叠或当前图无足够区分证据，selectedGroupId=null，不能为了唯一身份硬否定另一个组。不添加未见的房间隔断或通路。只输出JSON：{"selectedGroupId":"输入候选groupId或null","groupChecks":[{"groupId":"每个候选准确ID","support":"instance-supported或shared-appearance-only或conflict或uncertain","evidence":"具体对照原图事实"}],"sourceIds":["CURRENT及所有实际交付MEMBER准确ID"]}。选择某组需要它instance-supported，其他组仅shared-appearance-only或conflict；shared-appearance-only表示原先独立比较的same缺乏实例支持，不是证明物理上不同。',data,images:images(ids,byId.get(data.current.id)!)});
   }}:{}
  });agents.set(row.scene,agent);}
  const result=await agent.observe({id:row.id,atMs:row.atMs});predictions[index]={id:row.id,placeId:result.placeId,status:'completed'};
  await appendFile(join(root,'events.jsonl'),JSON.stringify({scene:row.scene,result})+'\n');
 }catch(e){error=String(e);predictions[index]={id:row.id,placeId:null,status:'failed'};await writeFile(join(root,'stopped.json'),JSON.stringify({id:row.id,error}));break;}
 finally{await writeFile(join(root,'predictions.json'),JSON.stringify({runId:root,predictions},null,2));}
}
console.log(JSON.stringify({root,error,completed:predictions.filter(p=>p.status==='completed').length,total:rows.length}));

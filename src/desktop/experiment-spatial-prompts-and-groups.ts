import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {CampusSource} from '../assistant/campus-source.js';
import {spatialJsonVlm,type SpatialJsonImage} from '../agent/spatial-json-vlm.js';
import {independentPerceptionPrompt,parseSpatialPerception} from '../agent/spatial-separated-protocol.js';
import {FixedScopePlaceGroup,parsePlaceScope,placeScopePrompt,groupMembershipPrompt} from '../agent/spatial-place-contract.js';

if(!process.argv.includes('--confirm-paid'))throw Error('Require --confirm-paid; isolated prompt/packing and fixed-group diagnostics, max estimated USD0.35');
const root=resolve('run/spatial-prompt-group-diagnostic',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});console.log(root);
const manifest='run/inspect-repair-full90-v1/model-replay/observations.jsonl',source=await CampusSource.load(manifest);
const rows=(await readFile(manifest,'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line)),byId=new Map(rows.map((r,index)=>[r.id,{row:r,index}]));
const rowAt=(ep:number,seconds:number)=>rows[source.indexAt(ep,seconds*1000)];
const samples=[rowAt(6,16),rowAt(6,48),rowAt(6,62),rowAt(1,144),rowAt(1,176)];
const privateChecks={perception:samples.map((r,i)=>({id:r.id,expected:['inside-marked-outdoor-court','inside-marked-outdoor-court','outside-court-wall-fence-stone-path','indoor-tiled-corridor','indoor-wood-floor-gym'][i],status:'manual-development-inspection-not-independent-GT'})),groups:[{key:'g1',seeds:[rowAt(6,0).id,rowAt(6,4).id],queries:[{id:rowAt(6,16).id,expected:'different'}]},{key:'g2',seeds:[rowAt(6,16).id,rowAt(6,32).id],queries:[{id:rowAt(6,48).id,expected:'belongs'},{id:rowAt(6,62).id,expected:'different'}]}],note:'Private only; perception labels and group query outcomes never supplied to models. Supplied causal seed memberships make group tests component diagnostics, NOT online grouping from empty memory.'};
await writeFile(join(root,'private-checks.json'),JSON.stringify(privateChecks,null,2));
await writeFile(join(root,'triptych-sources.json'),JSON.stringify(samples.map(r=>({id:r.id,cameras:r.cameras,sha256:r.sha256})),null,2));
const python=resolve('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
try{await promisify(execFile)(python,['scripts/build-spatial-prompt-triptychs.py',join(root,'triptych-sources.json'),join(root,'triptychs')]);}
catch(error){await writeFile(join(root,'stopped.json'),JSON.stringify({stage:'local-image-preparation',error:String(error),modelCalls:0}));throw error;}
const packed=JSON.parse(await readFile(join(root,'triptychs/provenance.json'),'utf8')) as Array<{id:string;path:string;sha256:string}>;
const neutral=independentPerceptionPrompt.replace('画面里有球架不等于在球场。','');
if(neutral===independentPerceptionPrompt)throw Error('Specific-negative prompt ablation no longer matches frozen base');
const groundFirst='只读取同一位置同一时刻的CURRENT三视图，无历史身份。先观察每个方向的地面和边界，再归纳所在区域，最后给名称。不要将不同方向的网格自动当成同一道围栏；应根据遮挡、地面是否连续、开口和物体位于哪一道边界前后分别判断。图中出现网格不证明它一定挡在观察者与某目标之间，也不证明在同一侧。区分直接可见事实和不确定的深度/占据关系，不先猜功能名再补理由。只输出JSON：{"observationId":"CURRENT准确ID","layoutEvidence":["front直接可见的脚下地面/最近边界事实","left的直接可见布局事实","right的直接可见布局事实","综合三视图的所在区域依据，不能推定不可见的穿越"],"uncertainties":["无法从原图确认的具体关系，可空"],"region":"根据上述事实归纳的简短所在区域","clearRegion":true,"retrievalQueries":[],"sourceIds":["CURRENT准确ID"]}。布局依据最多4项，每项240字内；若占据关系不足以确定，clearRegion=false，不补画不存在的边界。';
const methods=[{key:'original-separate',prompt:independentPerceptionPrompt,packing:'separate'},{key:'negative-removed-separate',prompt:neutral,packing:'separate'},{key:'original-triptych',prompt:independentPerceptionPrompt,packing:'triptych'},{key:'negative-removed-triptych',prompt:neutral,packing:'triptych'},{key:'ground-first-separate',prompt:groundFirst,packing:'separate'}];
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const originals=['run/inspect-repair-full90-v1/memory.sqlite','run/campus-spatial-memory/2026-10-20T13-42-03-856Z-ecad0254/memory.sqlite'];
const originalHashes=Object.fromEntries(await Promise.all(originals.map(async p=>[p,await hash(p)])));
const files=['src/desktop/experiment-spatial-prompts-and-groups.ts','src/agent/spatial-place-contract.ts','src/agent/spatial-json-vlm.ts','src/agent/spatial-separated-protocol.ts','scripts/build-spatial-prompt-triptychs.py'];
await writeFile(join(root,'frozen.json'),JSON.stringify({schema:'spatial-prompt-group-diagnostic-v1',sourceManifestSha256:source.manifestSha256,sampleIds:samples.map(r=>r.id),methods,sourceHashes:Object.fromEntries(await Promise.all(files.map(async p=>[p,await hash(p)]))),privateChecksSha256:await hash(join(root,'private-checks.json')),triptychProvenanceSha256:await hash(join(root,'triptychs/provenance.json')),originalHashes,maxCalls:64,maxEstimatedUSD:.35,plannedCalls:48,outdoorRepeats:2,indoorRepeats:1,model:'qwen3.8-flash',enableThinking:false,temperature:0,warning:'Known difficult samples, tiny repeated development diagnostic, no independent semantic grader or full-scene acceptance. Native panels only, provider-internal resizing unknown. Group trials use supplied seed memberships, model-generated frozen names and all seed images; no GT name supplied.'},null,2));
const request=spatialJsonVlm(join(root,'requests'),64,.35);
const imageRows=async(ids:string[],atMs:number):Promise<SpatialJsonImage[]>=>{
 const images:SpatialJsonImage[]=[];
 for(const id of ids){const meta=byId.get(id);if(!meta)throw Error('Unknown original');const row=await source.read(meta.index);if(row.atMs>atMs)throw Error('Future original image');for(const view of row.views)images.push({id,direction:view.direction,path:view.path,sha256:view.sha256});}return images;
};
const results:unknown[]=[];let error:string|null=null;
try{
 // Interleave conditions per source; no conversation or output sharing between requests.
 for(const row of samples)for(const repeat of row.episodeNumber===6?[1,2]:[1])for(const method of methods){
  const images=method.packing==='separate'?await imageRows([row.id],row.atMs):packed.filter(p=>p.id===row.id).map(p=>({id:p.id,direction:'native panels from left to right: LEFT | FRONT | RIGHT; simultaneous views, no geometric panorama',path:p.path,sha256:p.sha256}));
  const raw=await request({phase:'perception',prompt:method.prompt,data:{current:{id:row.id,atMs:row.atMs}},images});
  let parsed:unknown=null,protocolError:string|null=null;try{parsed=parseSpatialPerception(raw,row.id);}catch(e){protocolError=String(e);}
  const result={kind:'perception',sourceId:row.id,repeat,method:method.key,raw,parsed,protocolError};results.push(result);await appendFile(join(root,'results.jsonl'),JSON.stringify(result)+'\n');
 }
 for(const spec of privateChecks.groups){
  const members=spec.seeds.map(id=>({id,atMs:byId.get(id)!.row.atMs}));const last=members.at(-1)!;
  const raw=await request({phase:'identity',prompt:placeScopePrompt+' 本次所有图都是SEED；CURRENT仅表示最新种子，不是待分类的新图。',data:{current:{id:last.id,atMs:last.atMs},seedIds:members.map(m=>m.id)},images:await imageRows(spec.seeds,last.atMs)});
  const scopeRecord={kind:'scope-creation',groupId:spec.key,raw};results.push(scopeRecord);await appendFile(join(root,'results.jsonl'),JSON.stringify(scopeRecord)+'\n');
  if((raw as any)?.coherent!==true)continue;
  const group=new FixedScopePlaceGroup(spec.key,parsePlaceScope((raw as any).scope,members),members);
  await writeFile(join(root,`${spec.key}-scope.json`),JSON.stringify(group.snapshot(),null,2));
  for(const query of spec.queries)for(const condition of ['all-images-only','fixed-name-and-scope']){
   const current=byId.get(query.id)!.row,plan=group.plan({id:current.id,atMs:current.atMs});const answers:unknown[]=[];
   for(const [pageIndex,page] of plan.pages.entries())answers.push(await request({phase:'identity',prompt:groupMembershipPrompt,data:{current:{id:current.id,atMs:current.atMs},groupId:spec.key,version:plan.version,pageIndex,memberIds:page.map(m=>m.id),...condition==='fixed-name-and-scope'?{scope:group.snapshot().scope}:{}},images:await imageRows([current.id,...page.map(m=>m.id)],current.atMs)}));
   let evaluation:unknown=null,protocolError:string|null=null;try{evaluation=group.evaluate(plan,answers);}catch(e){protocolError=String(e);}
   const result={kind:'group-membership',groupId:spec.key,sourceId:current.id,condition,answers,evaluation,protocolError,scopeUnchanged:true,note:'No member append in this ablation; every query starts from the same frozen seed group.'};results.push(result);await appendFile(join(root,'results.jsonl'),JSON.stringify(result)+'\n');
  }
 }
}catch(e){error=String(e);await writeFile(join(root,'stopped.json'),JSON.stringify({error,completedResults:results.length}));}
const afterHashes=Object.fromEntries(await Promise.all(originals.map(async p=>[p,await hash(p)])));
let usage:unknown=null;try{usage=JSON.parse(await readFile(join(root,'requests/usage.json'),'utf8'));}catch{}
await writeFile(join(root,'report.json'),JSON.stringify({error,results,usage,originalsUnchanged:JSON.stringify(originalHashes)===JSON.stringify(afterHashes),afterHashes,semanticScoring:'Await explicit original-image/raw-output development audit; not automatic keyword accuracy.'},null,2));
console.log(JSON.stringify({root,error,results:results.length,usage,originalsUnchanged:JSON.stringify(originalHashes)===JSON.stringify(afterHashes)}));

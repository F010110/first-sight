import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
import {digest,loadJSON} from './spatial-evaluation-pipeline.js';
import {validateReferenceDraft,verifyReference} from './frozen-memory-reference.js';

const [outArg,confirm]=process.argv.slice(2);if(!outArg||confirm!=='--confirm-paid')throw Error('Usage: prepare-full-memory-standard NEW-OUTPUT --confirm-paid');
const out=resolve(outArg),inputPath='run/unioncity-questions90-v2-run1/input.json',inputRaw=await readFile(inputPath),input=JSON.parse(inputRaw.toString()),rows=input.observations;
if(rows.length!==813||digest(inputRaw)!=='78735bd7e0b9ab61aaa27c984471db6a75751b616730ce900df113cb78c3ec40')throw Error('Full original source binding changed');
await mkdir(out,{recursive:false});await mkdir(join(out,'evaluation-only'));
const model='qwen3.8-max-0902',request=evaluationJsonVlm(join(out,'requests'),rows.length*4,{transport:'qwen'});
const pilotRoot='run/unioncity-repair-pilot-v2-freeze',questionRoot='run/unioncity-questions90-v2-freeze';
const approved90=await loadJSON(join(questionRoot,'frozen.json')),approvedPilot=await loadJSON(join(pilotRoot,'plan.json'));
if(digest(await readFile(join(questionRoot,'tasks.json')))!==approved90.hashes['tasks.json']||digest(await readFile(join(questionRoot,'evaluation-only/references.json')))!==approved90.hashes['evaluation-only/references.json']||digest(await readFile(join(pilotRoot,'tasks.json')))!==approvedPilot.tasksSHA256||digest(await readFile(join(pilotRoot,'evaluation-only/references.json')))!==approvedPilot.referencesSHA256)throw Error('Approved question/reference freeze changed');
const bindings:Record<string,string>={};
for(const [source,target] of [
 [join(questionRoot,'tasks.json'),'tasks90.json'],[join(questionRoot,'evaluation-only/references.json'),'evaluation-only/question-references90.json'],
 [join(pilotRoot,'tasks.json'),'tasks15.json'],[join(pilotRoot,'plan.json'),'evaluation-only/original-gate-plan.json'],[join(pilotRoot,'evaluation-only/references.json'),'evaluation-only/question-references15.json'],
 [join(pilotRoot,'evaluation-only/calibrated-pilot-notes.json'),'evaluation-only/question-calibration-notes.json'],
 ['data/annotations/unioncity-rerender-v2-user-acceptance.json','evaluation-only/annotation-authority.json']
 ] as const){const bytes=await readFile(source);await writeFile(join(out,target),bytes,{flag:'wx'});bindings[target]=digest(bytes);}
const annotation=await loadJSON('run/gmod-annotated-rerender-v2-final/sample.json');
// Existing accepted spatial reference is offline-only. Do not promote segment inventories to per-frame visibility.
const structure={schema:'frozen-spatial-structure-v1',authority:'Previously accepted assistant annotations, not independent human gold',sourceSHA256:digest(await readFile('run/gmod-annotated-rerender-v2-final/sample.json')),frames:annotation.frames.map((f:any)=>({id:f.id,atMs:f.atMs,region:f.annotation.placeId,facility:f.annotation.facilityId,visibility:f.annotation.visibility,boundaryUncertain:f.annotation.boundaryUncertain,scope:'Observer-region reference, NOT a camera-visible room label'})),segments:annotation.segments,revisits:annotation.revisits.map((r:any)=>({id:r.id,firstId:rows[r.firstIndex].id,returnId:rows[r.returnIndex].id,relation:'same-region',basis:r.basis}))};
await writeFile(join(out,'evaluation-only/spatial-structure.json'),JSON.stringify(structure,null,2));bindings['evaluation-only/spatial-structure.json']=digest(await readFile(join(out,'evaluation-only/spatial-structure.json')));
await writeFile(join(out,'preparation-policy.json'),JSON.stringify({schema:'full-memory-reference-preparation-v1',inputPath,inputSHA256:digest(inputRaw),observations:813,model,authority:'Frozen Max-drafted, separately image-verified reference; assistant annotations accepted for proceeding, not independent human gold',candidateRead:false,questionTextUnchanged:true,structureDoesNotImplyPerViewVisibility:true,referenceFirst:true,concurrency:4},null,2));
const draftPrompt='你在候选系统运行之前建立固定图像参考答案，不评分任何候选。只检查交付的当前三张原图；按front/left/right分别列3至5项重要直接可见事实（暗处可少于3项），总计最多15项。优先场景内外差异、主要物体、边界和清晰可见状态，不穷举细枝末节。不猜用途、时段、未见动作、路径许可、模糊文字或精确数量。每项简洁且可从指定方向原图核对，importance为core或detail。未知事项写unknowns，不补全。输出JSON {"facts":[{"camera":"front","text":"具体可见事实","importance":"core"}],"unknowns":[]}。';
const verifyPrompt='你是固定参考答案的独立复核请求，尚无被评候选输出。逐项对照原图检查draft facts。只保留图像明确支持且方向正确的事实，无法确认为uncertain，错误为rejected；不要为了同意草稿而补证据，不发明替代答案。图内左右与摄像头标签分开。暗处、模糊文字、用途、时段、无根据数量应排除。每个输入ID必须检查一次。输出JSON {"checks":[{"id":"f0","verdict":"supported或rejected或uncertain","reason":"图像依据"}],"unknowns":[]}。';
await writeFile(join(out,'reference-prompts.json'),JSON.stringify({draftPrompt,verifyPrompt},null,2));
let cursor=0,completed=0;const results:any[]=new Array(rows.length),errors:any[]=[];
async function worker(workerId:number){while(cursor<rows.length){const index=cursor++,row=rows[index],images=row.views.map((v:any)=>({...v,id:row.id}));let result:any=null,error:string|null=null;
 for(let attempt=0;attempt<2;attempt++){try{
  const draft=validateReferenceDraft(await request(model,draftPrompt,{current:{id:row.id,atMs:row.atMs}},images));
  await appendFile(join(out,'drafts.jsonl'),JSON.stringify({id:row.id,attempt,draft})+'\n');
  const verified=verifyReference(draft,await request(model,verifyPrompt,{current:{id:row.id,atMs:row.atMs},draft:draft.facts},[...images].reverse()));
  if(!verified.facts.length&&!verified.unknowns.length)throw Error('Empty reference without explicit unknown visibility');
  result={id:row.id,atMs:row.atMs,facts:verified.facts,unknowns:verified.unknowns,checks:verified.checks,images:images.map((i:any)=>({direction:i.direction,sha256:i.sha256})),authority:'Frozen Max draft plus separate original-image verification; not human gold'};break;
 }catch(e){error=String(e);await appendFile(join(out,'preparation-failures.jsonl'),JSON.stringify({id:row.id,attempt,error})+'\n');if(/HTTP 40[13]|HTTP 429/.test(error))break;}}
 if(result){results[index]=result;await appendFile(join(out,'verified-frames.jsonl'),JSON.stringify(result)+'\n');}else errors.push({id:row.id,error});
 completed++;await writeFile(join(out,`progress-worker-${workerId}.json`),JSON.stringify({settled:completed,planned:rows.length,failed:errors.length,lastId:row.id}));console.log(JSON.stringify({stage:'prepare-reference',settled:completed,planned:813,id:row.id,verified:!!result}));
}}
await Promise.all([worker(0),worker(1),worker(2),worker(3)]);
if(errors.length){await writeFile(join(out,'blocked.json'),JSON.stringify({reason:'Incomplete standard; inference not authorized to start',errors},null,2));throw Error('Reference preparation incomplete');}
const refRaw=JSON.stringify({schema:'frozen-spatial-facts-v1',inputSHA256:digest(inputRaw),frames:results},null,2);await writeFile(join(out,'evaluation-only/spatial-facts.json'),refRaw,{flag:'wx'});bindings['evaluation-only/spatial-facts.json']=digest(refRaw);
await writeFile(join(out,'frozen.json'),JSON.stringify({schema:'full-memory-standard-v1',inputPath,inputSHA256:digest(inputRaw),observations:813,bindings,questions90Frozen:true,questionPilotGate:'Original15-questions37-branches-unchanged-before90',referenceAuthority:'Max-drafted verified silver reference, not independently certified human gold',candidateOutputRead:false,complete:true},null,2),{flag:'wx'});
console.log(JSON.stringify({stage:'reference-frozen',out,observations:813,hashes:bindings}));

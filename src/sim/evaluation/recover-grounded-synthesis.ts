import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {sha} from './holistic-memory-bundle.js';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
import {applySynthesis,scoreCaps,synthesisPrompt,overallScore,validateGrounded,validateComparison} from './grounded-memory-review.js';
import {groupedMemoryReport,renderGroupedMarkdown} from './grouped-memory-report.js';
const [arg,dest,confirm]=process.argv.slice(2);
if(!arg||!dest||confirm!=='--confirm-paid')throw Error('Usage: recover-grounded-synthesis REVIEW NEW-OUTPUT --confirm-paid');
const root=resolve(arg),out=resolve(dest),load=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const bundle=await load(join(root,'bundle.json')),policy=await load(join(root,'grounded-policy.json')),prior=await load(join(root,'report.json'));
if(sha(await readFile(join(root,'bundle.json')))!==policy.bundleSHA256||sha(await readFile(join(bundle.run,'spatial.sqlite')))!==bundle.hashes.database)throw Error('Changed bundle or producer');
const versions=bundle.states.map((s:any)=>s.version),claims=new Map<number,unknown>(bundle.states.map((s:any)=>[s.version,{observationId:s.observationId,memberIds:s.memberIds,assessment:s.assessment,locationDecision:s.locationDecision,memoryReceipt:s.memoryReceipt}]));
validateGrounded({windows:prior.grounding},versions);
for(const c of prior.comparisons)validateComparison(c,c.windows.map((w:any)=>w.version),claims,new Set<string>(bundle.observations.map((o:any)=>o.id)));
const reviewed=prior.comparisons.flatMap((c:any)=>c.windows.map((w:any)=>w.version));
if(reviewed.length!==versions.length||new Set(reviewed).size!==versions.length||versions.some((v:number)=>!reviewed.includes(v)))throw Error('Incomplete prior comparisons');
await mkdir(out,{recursive:false});
await writeFile(join(out,'bindings.json'),JSON.stringify({priorReportSHA256:sha(await readFile(join(root,'report.json'))),bundleSHA256:policy.bundleSHA256,reusedReview:root,scope:'Synthesis only; prior failures preserved'},null,2),{flag:'wx'});
const request=evaluationJsonVlm(join(out,'requests'),2,{transport:'qwen',allowTextOnly:true,maxInputChars:400000,maxTotalTokens:600000,allowFlash:true});
const data={windowVerdicts:prior.comparisons.flatMap((c:any)=>c.windows),confirmedFindings:prior.comparisons.flatMap((c:any)=>c.findings),programCaps:scoreCaps(prior.comparisons),originalClaims:bundle.claims,organization:{places:bundle.places,visits:bundle.visits,revisions:bundle.revisions}};
let final,feedback='';
for(let i=0;i<2;i++){
 const raw=await request(policy.model,synthesisPrompt+'\nextraFindings.quote只能逐字复制originalClaims内的单个字符串，不能引用评审意见。没有新增可绑定问题则extraFindings=[]；已确认问题保留在confirmedFindings，不必重复。'+feedback,data,[]);
 try{final=applySynthesis(raw,prior.comparisons,bundle.claims.map((c:any)=>c.value));break;}catch(e){feedback='\n前次校验错误：'+String(e);await writeFile(join(out,`invalid-${i}.json`),JSON.stringify({raw,error:String(e)},null,2),{flag:'wx'});}
}
if(!final)throw Error('Recovery synthesis failed validation');
const groups=groupedMemoryReport(bundle,{segments:bundle.segments},prior.comparisons.flatMap((c:any)=>c.windows));
await writeFile(join(out,'groups.json'),JSON.stringify(groups,null,2),{flag:'wx'});
await writeFile(join(out,'groups.md'),renderGroupedMarkdown(groups),{flag:'wx'});
if(sha(await readFile(join(bundle.run,'spatial.sqlite')))!==bundle.hashes.database)throw Error('Producer changed');
const report={...prior,completed:true,error:null,recovery:{stage:'synthesis-only',source:root},...final,scores:{overall:overallScore(final.dimensions),unit:'holistic-ordinal-judgment-not-accuracy'},grouped:groups.summary,gate:{requiresHumanReview:true,automatic813:false}};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({completed:true,scores:report.scores,dimensions:final.dimensions,groups:groups.summary}));

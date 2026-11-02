import {readFile,writeFile,mkdir,readdir,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {splitQuestionReview,scoreSplitReview,summarizeSplitScores} from './split-question-review.js';

const [runArg,gradeArg,outArg,...flags]=process.argv.slice(2);
if(!runArg||!gradeArg||!outArg||flags.length)throw Error('Usage: review-saved-pilot-grades RUN OLD-GRADE-DIR NEW-OUTPUT (offline; no model calls)');
const run=resolve(runArg),grade=resolve(gradeArg),out=resolve(outArg),load=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const sha=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex');
const resultsRaw=await readFile(join(run,'results.jsonl'),'utf8'),results=resultsRaw.trim().split('\n').map(line=>JSON.parse(line));
const inputs=new Map<string,{path:string;input:any}>();
for(const entry of await readdir(join(grade,'requests'),{withFileTypes:true}))if(entry.isDirectory()&&/^\d+$/.test(entry.name)){
 const path=join(grade,'requests',entry.name),input=await load(join(path,'input.json'));
 inputs.set(input.data.question+':'+input.data.mode,{path,input});
}
await mkdir(out,{recursive:false});const reviewed:any[]=[];
for(const result of results){
 const saved=inputs.get(result.question+':'+result.mode);let raw:unknown=null,error:string|null=null,responseSHA256:string|null=null;
 if(saved)try{
  const bytes=await readFile(join(saved.path,'response.txt'));responseSHA256=sha(bytes);const response=JSON.parse(bytes.toString());
  if(response.choices?.[0]?.finish_reason!=='stop')throw Error('Saved judge response did not finish normally');
  raw=JSON.parse(response.choices[0].message.content);
  const bindings=new Map<string,string>(saved.input.metadata.referenceBindings.map((b:any)=>[b.alias,b.originalId]));
  const decode=(value:any,key=''):any=>{
   if(typeof value==='string'&&['sourceIds','observationId','id'].includes(key))return bindings.get(value)??value;
   if(Array.isArray(value))return value.map(v=>decode(v,key));
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v,k)]));
   return value;
  };
  raw=decode(raw);
 }catch(e){error=String(e);}
 const split=splitQuestionReview(raw,result);
 // Scoring-only answerability, never supplied to the answering policy. Ambiguous referents stay ambiguous.
 const answerability=['S20','S27'].includes(result.id)?'ambiguous' as const:'answerable' as const;
 const score=scoreSplitReview(result,split,answerability);
 const row={id:result.id,mode:result.mode,answerability,score,split,parseError:error,savedJudgePath:saved?.path??null,responseSHA256};
 reviewed.push(row);await appendFile(join(out,'split-reviews.jsonl'),JSON.stringify(row)+'\n');
}
const byMode=['normal','memory-disabled','supplied-evidence-diagnostic'].map(mode=>({mode,...summarizeSplitScores(reviewed.filter(r=>r.mode===mode).map(r=>({utility:r.score.utility}))),
 semanticValid:reviewed.filter(r=>r.mode===mode&&r.split.semantic).length,mechanismValid:reviewed.filter(r=>r.mode===mode&&r.split.mechanism).length}));
const oldSourceUnchanged=sha(await readFile(join(run,'results.jsonl'),'utf8'))===sha(resultsRaw);
const receipt={schema:'offline-split-judge-review-v1',rows:reviewed.length,byMode,oldSourceUnchanged,paidCalls:0,
 semanticRecoveredDespiteInvalidMechanism:reviewed.filter(r=>r.split.semantic&&!r.split.mechanism).map(r=>({id:r.id,mode:r.mode})),
 limitations:['Same saved model judgments, not a new independent reference or judge','Separating channels repairs grading pipeline loss, not every semantic judgment','No normal/oracle pooling; unknown grades retain planned denominators','Answerability policy marks known ambiguous referents separately; further semantic adjudication may still be needed']};
await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt,null,2));

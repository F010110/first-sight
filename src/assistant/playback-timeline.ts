import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

export interface TimedQuestion {id:string;episodeNumber:number;atMs:number;question:string;answer:string|null;answerAtMs:number|null}
/** Align actual question/answer events to source time, not the computer wall clock. */
export function alignQuestions(events:Array<{kind:string;atMs:number;value:any}>):TimedQuestion[]{
 let frame:any=null;const questions:TimedQuestion[]=[],accepted=new Map<string,{question:TimedQuestion;wallMs:number}>();
 for(const event of events){
  if(event.kind==='campus-frame'){frame=event.value;continue;}
  if(event.kind==='task-created'&&frame&&Number.isFinite(frame.scheduleAtMs)){
   const question:TimedQuestion={id:event.value.id,episodeNumber:frame.episodeNumber,atMs:frame.scheduleAtMs,question:event.value.text,answer:null,answerAtMs:null};
   questions.push(question);accepted.set(question.id,{question,wallMs:event.atMs});
  }else if(event.kind==='message-delivered'){
   const entry=accepted.get(event.value.taskId);if(!entry)continue;
   entry.question.answer=event.value.text;entry.question.answerAtMs=entry.question.atMs+Math.max(0,event.atMs-entry.wallMs);
  }
 }
 return questions.sort((a,b)=>a.atMs-b.atMs);
}
export async function latestQuestionTimeline(root:string){
 let names:string[]=[];try{names=await readdir(root);}catch{}
 for(const name of names.sort().reverse()){
  if(!/^[\w.-]+$/.test(name))continue;
  try{
   const report=JSON.parse(await readFile(join(root,name,'report.json'),'utf8'));
   if(report.mode!=='question-only'||!report.completedScript)continue;
   const events=(await readFile(join(root,name,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
   return {run:name,questions:alignQuestions(events)};
  }catch{}
 }
 return {run:null,questions:[] as TimedQuestion[]};
}

/** Presentation label compressed from the spatial Agent's existing judgment only.
 * Not a new visual inference, official room label or ground truth. */
export function shortLocation(reason:string,placeId:string|null){
 if(!placeId)return '位置不确定';
 const names=['室外通道','室内走廊','体育馆','篮球场','更衣室','楼梯间','楼梯平台','楼梯','大厅','庭院','操场','教室','走廊','通道','室外场地'];
 return names.find(name=>reason.includes(name))??'未命名地点';
}

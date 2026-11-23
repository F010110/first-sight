import type {RealtimeMemory} from '../hardware/realtime-memory.js';
import type {SpatialJsonRequest} from '../agent/spatial-json-vlm.js';

export interface EgoLifeTask {
 ID:string;type:string;question:string;choices:Record<'A'|'B'|'C'|'D',string>;
 queryTime:{date:string;time:string};untilTime:number;cutoffMs:number;
}
type Snapshot=ReturnType<RealtimeMemory['snapshot']>;
type NativeAnswerer=(snapshot:Snapshot,text:string,request:(r:SpatialJsonRequest)=>Promise<unknown>,active:boolean)=>Promise<{text:string;sourceIds:string[];abstained:boolean;asOfMs:number}>;

/** EgoLife HHMMSSff is a source clock, NOT milliseconds or a Unix timestamp. */
export function egoLifeTime(date:unknown,time:unknown){
 if(typeof date!=='string'||!/^DAY[1-7]$/.test(date))throw Error('Expected official DAY1..DAY7');
 const digits=String(time).padStart(8,'0');if(!/^\d{8}$/.test(digits))throw Error('Invalid HHMMSSff');
 const hour=Number(digits.slice(0,2)),minute=Number(digits.slice(2,4)),second=Number(digits.slice(4,6)),centisecond=Number(digits.slice(6,8));
 if(hour>=24||minute>=60||second>=60)throw Error('Invalid source clock');
 return {untilTime:Number(date.slice(3)+digits),cutoffMs:((Number(date.slice(3))-1)*86400+hour*3600+minute*60+second)*1000+centisecond*10};
}

/** Explicit allowlist: gold, target_time, reason, keywords and trigger NEVER leave evaluator. */
export function egoLifeTask(row:unknown):EgoLifeTask{
 const r=row as any;
 if(!r||!['string','number'].includes(typeof r.ID)||!String(r.ID).trim()||typeof r.type!=='string'||typeof r.question!=='string'||!r.question.trim())throw Error('Invalid official question');
 const choices={} as EgoLifeTask['choices'];for(const [letter,key] of [['A','choice_a'],['B','choice_b'],['C','choice_c'],['D','choice_d']] as const){if(typeof r[key]!=='string'||!r[key].trim())throw Error('Missing official choice');choices[letter]=r[key];}
 const clock=egoLifeTime(r.query_time?.date,r.query_time?.time);
 return {ID:String(r.ID),type:r.type,question:r.question,choices,queryTime:{date:r.query_time.date,time:String(r.query_time.time).padStart(8,'0')},...clock};
}

export function egoLifeQuestionText(task:EgoLifeTask){
 return `历史经历选择题。回放发问时刻为${task.queryTime.date} ${task.queryTime.time}（源视频HHMMSSff，不是实时墙钟）；只能使用该时刻之前实际记录的证据。\nQuestion: ${task.question}\n${Object.entries(task.choices).map(([k,v])=>`(${k}) ${v}`).join('\n')}\n取证工具和sourceIds规则保持不变。证据支持时，最终answer动作的text只写A/B/C/D之一；证据不足则abstained=true，不强行猜。`;
}

/** Normalize from choices, NEVER from gold. Avoid upstream's loose initial-letter trap. */
export function canonicalEgoLifeResponse(text:string,choices:EgoLifeTask['choices']):string|null{
 const exact=text.trim().match(/^\(?([ABCD])\)?[.)]?$/i);if(exact)return exact[1]!.toUpperCase();
 const norm=(s:string)=>s.toLowerCase().trim().replace(/[.,)]+$/,'');
 const matches=Object.entries(choices).filter(([,value])=>norm(value)===norm(text));return matches.length===1?matches[0]![0]:null;
}

/** Inject a version-pinned native question function; never imports/replaces a memory engine. */
export async function answerEgoLifeWithFirstSight(task:EgoLifeTask,snapshot:Snapshot,nativeAnswer:NativeAnswerer,request:(r:SpatialJsonRequest)=>Promise<unknown>){
 if(snapshot.asOfMs!==task.cutoffMs||snapshot.rows.some(row=>row.original.atMs>task.cutoffMs||row.availableAtMs!==null&&row.availableAtMs>task.cutoffMs))throw Error('Snapshot clock mismatch or future evidence');
 const result=await nativeAnswer(structuredClone(snapshot),egoLifeQuestionText(task),request,false);
 const response=result.abstained?null:canonicalEgoLifeResponse(result.text,task.choices);
 // Upstream evaluate_prediction('Abstained', gold='A', ...) can count as A!
 // Its own failed-answer sentinel is Error. Preserve abstention status separately.
 return {ID:task.ID,type:task.type,question:task.question,choices:task.choices,query_time:task.untilTime,response:response??'Error',status:result.abstained?'abstained':response?'answered':'protocol_failed',rawFirstSightAnswer:result};
}

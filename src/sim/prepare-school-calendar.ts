/** Additive assumed-date view. Never rewrite the frozen replay or task truth. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {wallTime,type MemoryClock} from '../agent/memory-clock.js';import type {MemoryRow} from './memory-evaluation-session.js';
const [source,output]=process.argv.slice(2);if(!source||!output)throw Error('Usage: completed-group NEW-output');
const root=resolve(output);await mkdir(root,{recursive:false});const replay=await readFile(join(source,'model-replay/observations.jsonl'),'utf8');
const rows:MemoryRow[]=replay.trim().split(/\r?\n/).map(s=>JSON.parse(s));const questions=JSON.parse(await readFile(join(source,'model-questions.json'),'utf8'));
const clock:MemoryClock={kind:'assumed',sourceOriginMs:Math.min(...rows.map(r=>r.atMs)),wallOrigin:'2026-10-18T09:00:00+08:00',offsetMinutes:480};
const calendarQuestions=questions.map((q:any)=>({...q,originalQuestion:q.question,question:q.question.replace(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/g,(reference:string,episode:string,seconds:string)=>{const row=rows.find(r=>r.episodeNumber===Number(episode)&&Math.abs(r.sourceAtMs-Number(seconds)*1000)<1&&r.atMs<q.queryAtMs);return row?wallTime(row.atMs,clock):reference;}),queryTime:wallTime(q.queryAtMs,clock)}));
await writeFile(join(root,'clock.json'),JSON.stringify({clock,assumption:'User-authorized synthetic calendar anchor, NOT actual recording date. Original episode times retained for evidence audit.',replaySha256:createHash('sha256').update(replay).digest('hex'),observations:rows.map(r=>({id:r.id,recordedTime:wallTime(r.atMs,clock)}))},null,2));
await writeFile(join(root,'calendar-questions.json'),JSON.stringify(calendarQuestions,null,2));console.log('Prepared additive assumed-date clock and 90 public questions');

import {appendFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';

export function validateRealtimeInterval(intervalMs:number){if(intervalMs!==2000)throw Error('Spatial window runner currently supports only --interval-ms=2000; other intervals need a matching versioned window plan');}
/** Anchor the remaining suffix after initialization/recovery, preserving projected gaps. */
export function deliveryDueAt(rows:Pick<Observation,'atMs'>[],index:number,firstPendingIndex:number,anchorWallMs:number){
 if(!rows[index]||!rows[firstPendingIndex]||index<firstPendingIndex)throw Error('Invalid delivery suffix');
 return anchorWallMs+rows[index]!.atMs-rows[firstPendingIndex]!.atMs;
}
export function attemptArtifact(base:string,attemptId:string,resume:boolean){return resume?base+'-recovery-'+attemptId+'.json':base+'.json';}
export async function appendRunRecord(root:string,name:'delivery.jsonl'|'run-attempts.jsonl',value:unknown){await appendFile(join(root,name),JSON.stringify(value)+'\n');}
export async function readRunRecords<T>(root:string,name:'delivery.jsonl'|'run-attempts.jsonl'):Promise<T[]>{
 try{return (await readFile(join(root,name),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}

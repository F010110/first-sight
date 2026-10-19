import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {HistoricalEvidenceSession} from '../../agent/spatial-evidence-retrieve.js';
import type {RetrievalQuery} from '../../agent/spatial-retrieve.js';

export type MemoryMode='current-only'|'recent-5min'|'full-history';
export interface MemoryRow{id:string;atMs:number;sourceAtMs:number;episodeNumber:number;judgmentAvailableAtMs:number;cameras:Record<string,string>;sha256:Record<string,string>}
export function eligibleRows(rows:MemoryRow[],currentId:string,asOfMs:number,mode:MemoryMode){
 const current=rows.find(r=>r.id===currentId);if(!current||current.atMs>=asOfMs)throw Error('Invalid current/cutoff');
 if(!['current-only','recent-5min','full-history'].includes(mode))throw Error('Invalid mode');
 return rows.filter(r=>r.atMs<=current.atMs&&(mode!=='current-only'||r.id===currentId)&&(mode!=='recent-5min'||r.atMs>=current.atMs-300000));
}
/** Only model per-observation judgments are accepted. No label bank is read. */
export function memorySession(rows:MemoryRow[],currentId:string,asOfMs:number,mode:MemoryMode,assignments:Map<string,{placeId:string|null;reason:string}>,trace:(x:unknown)=>void):HistoricalEvidenceSession{
 const eligible=eligibleRows(rows,currentId,asOfMs,mode);const inspected=new Set<string>(),allowed=new Map<string,MemoryRow>();let searches=0,images=12;
 return {inspected,
 search(input:RetrievalQuery={}){
  if(++searches>12)throw Error('Search budget exceeded');const cursor=input.cursor??0,limit=input.limit??4;
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>24)throw Error('Invalid search page');
  const q=(input.query??'').trim();const reference=q.match(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/);
  const selected=eligible.filter(r=>{
   if(r.atMs>(input.beforeMs??Infinity)||r.atMs<(input.afterMs??-Infinity))return false;
   if(reference)return r.episodeNumber===Number(reference[1])&&Math.abs(r.sourceAtMs-Number(reference[2])*1000)<1;
   const visible=mode==='full-history'&&r.judgmentAvailableAtMs<asOfMs?assignments.get(r.id)?.reason??'':'';
   return !q||(`第${r.episodeNumber}段${r.sourceAtMs/1000}秒 ${visible}`).toLocaleLowerCase().includes(q.toLocaleLowerCase());
  });
  const hits=selected.slice(cursor,cursor+limit).map(r=>{
   allowed.set(r.id,r);const a=mode==='full-history'&&r.judgmentAvailableAtMs<asOfMs?assignments.get(r.id):undefined;
   return {id:r.id,atMs:r.atMs,sourceAtMs:r.sourceAtMs,recordingId:'activity',placeId:a?.placeId??null,reason:`第${r.episodeNumber}段${r.sourceAtMs/1000}秒 ${a?.reason??'原始记录；当前条件不提供全历史模型摘要'}`,imageCount:3};
  });trace({operation:'search',mode,query:q,returnedIds:hits.map(h=>h.id)});
  return {status:hits.length?'candidates':'unknown',hits,nextCursor:cursor+limit<selected.length?cursor+limit:null,remainingImages:images,changes:[],note:'Original recording timestamps are searchable as 第N段T秒. Restricted modes omit full-context judgments to prevent inherited memory leakage.'};
 },async inspect(ids:string[]){
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!allowed.has(id)))throw Error('Inspect needs in-scope searched IDs');
  if(ids.length*3>images)throw Error('Image budget exceeded');images-=ids.length*3;const output=[];
  for(const id of ids){const row=allowed.get(id)!;for(const [index,view] of ['front','left','right'].entries()){
   const bytes=await readFile(row.cameras[view]!);if(createHash('sha256').update(bytes).digest('hex')!==row.sha256[view])throw Error('Evidence hash mismatch');
   output.push({id,index,atMs:row.atMs,placeId:null,mimeType:'image/png',data:bytes.toString('base64')});
  }inspected.add(id);}trace({operation:'inspect',mode,ids});return output;
 },validateCitations(ids:string[],abstained=false){if(!Array.isArray(ids)||ids.some(id=>!inspected.has(id))||(!abstained&&!ids.length))throw Error('Citations need inspected in-scope original evidence');}
 };
}

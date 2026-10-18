import {SpatialRetriever,type RetrievalQuery} from '../agent/spatial-retrieve.js';
import type {HistoricalEvidenceSession} from '../agent/spatial-evidence-retrieve.js';
import type {MemoryRow} from './memory-evaluation-session.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {MemoryClock} from '../agent/memory-clock.js';

/** Clock bridge only: source times come from public observations, never labels. */
export function spatialAlgorithmSession(retriever:SpatialRetriever,rows:MemoryRow[],cutoff:number,trace:(v:unknown)=>void,clock?:MemoryClock):HistoricalEvidenceSession{
 const session=retriever.session({asOfMs:cutoff-1,judgmentUnavailableIds:rows.filter(r=>r.judgmentAvailableAtMs>=cutoff).map(r=>r.id),...clock?{clock}:{}},12);
 return {inspected:session.inspected,memorySummary:()=>session.memorySummary(),search(input:RetrievalQuery={}){
  const reference=input.query?.match(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/);
  let query=input;
  if(reference){const row=rows.find(r=>r.episodeNumber===Number(reference[1])&&Math.abs(r.sourceAtMs-Number(reference[2])*1000)<1);const {query:ignored,...rest}=input;query={...rest,afterMs:row?.atMs??cutoff+1,beforeMs:row?.atMs??cutoff+1};}
  const result=session.search(query);trace({operation:'SpatialRetriever.search',input,translatedQuery:query,returnedIds:result.hits.map(h=>h.id)});return result;
 },async inspect(ids){
  for(const id of ids){const row=rows.find(r=>r.id===id);if(!row||row.atMs>=cutoff)throw Error('Out-of-scope evidence');for(const view of ['front','left','right'])if(createHash('sha256').update(await readFile(row.cameras[view]!)).digest('hex')!==row.sha256[view])throw Error('Evidence integrity mismatch');}
  const result=await session.inspect(ids);trace({operation:'SpatialRetriever.inspect',ids});return result.map(image=>{const row=rows.find(r=>r.id===image.id)!;return {...image,sourceAtMs:row.sourceAtMs,episodeNumber:row.episodeNumber,sourceReference:`第${row.episodeNumber}段${row.sourceAtMs/1000}秒`};});
 },validateCitations:(ids,abstained)=>session.validateCitations(ids,abstained)};
}

/** Oracle candidates are evaluator-supplied reference IDs, never answer text. */
export function oracleSession(rows:MemoryRow[],ids:string[],cutoff:number,trace:(v:unknown)=>void):HistoricalEvidenceSession{
 const inspected=new Set<string>();let images=12;
 const candidates=ids.map(id=>{const row=rows.find(r=>r.id===id);if(!row||row.atMs>=cutoff)throw Error('Invalid oracle evidence');return row;});
 return {inspected,search(){trace({operation:'oracle.search',ids});return {status:candidates.length?'candidates':'unknown',hits:candidates.map(r=>({id:r.id,atMs:r.atMs,sourceAtMs:r.sourceAtMs,recordingId:undefined,placeId:null,reason:'Oracle-provided reference image; no answer label',imageCount:3})),nextCursor:null,remainingImages:images,changes:[],note:'Privileged reference-evidence upper bound.'};},async inspect(requested){
  if(new Set(requested).size!==requested.length||requested.some(id=>!ids.includes(id))||requested.length*3>images)throw Error('Invalid oracle inspection');images-=requested.length*3;
  const result=[];for(const id of requested){const row=candidates.find(r=>r.id===id)!;for(const [index,view] of ['front','left','right'].entries()){const bytes=await readFile(row.cameras[view]!);if(createHash('sha256').update(bytes).digest('hex')!==row.sha256[view])throw Error('Oracle evidence hash mismatch');result.push({id,index,atMs:row.atMs,placeId:null,mimeType:'image/png',data:bytes.toString('base64')});}inspected.add(id);}trace({operation:'oracle.inspect',ids:requested});return result;
 },validateCitations(citations,abstained=false){if(citations.some(id=>!inspected.has(id))||!abstained&&!citations.length)throw Error('Oracle answer requires supplied evidence citations');}};
}

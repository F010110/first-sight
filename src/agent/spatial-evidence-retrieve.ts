import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile,realpath,stat } from 'node:fs/promises';
import { existsSync,readFileSync,statSync } from 'node:fs';
import { resolve,join,relative,isAbsolute,extname } from 'node:path';
import type { RetrievalSession,RetrievalScope,RetrievalQuery } from './spatial-retrieve.js';
import {calendarFilters} from './memory-clock.js';

/** RequestAgent's minimal evidence interface; no dependency on a topology assignment. */
export type HistoricalEvidenceSession=Pick<RetrievalSession,'search'|'inspect'|'validateCitations'|'inspected'>;
type Evidence={id:string;sessionId:string;atMs:number;cameras:Record<string,string>;sha256:Record<string,string>};
export class SpatialEvidenceRetriever{
 private db:DatabaseSync;
 private textDb:DatabaseSync|undefined;
 constructor(private root:string,textIndex?:string){
  this.root=resolve(root);if(!existsSync(join(this.root,'complete.json')))throw Error('Incomplete evidence archive');
   this.db=new DatabaseSync(join(this.root,'evidence.sqlite'),{readOnly:true});
   if(textIndex){
    try{
     const manifest=JSON.parse(readFileSync(join(textIndex,'complete.json'),'utf8'));
     const hash=(path:string)=>{if(statSync(path).size>128*1024*1024)throw Error('Text index binding size budget exceeded');return createHash('sha256').update(readFileSync(path)).digest('hex');};
     if(manifest.method!=='bounded-temporal-fts5'||!Number.isInteger(manifest.documents)||manifest.documents<0||manifest.documents>10000||manifest.archiveSha256!==hash(join(this.root,'evidence.sqlite'))||manifest.indexSha256!==hash(join(textIndex,'text.sqlite')))throw Error('Text index integrity/archive binding mismatch');
     this.textDb=new DatabaseSync(join(textIndex,'text.sqlite'),{readOnly:true});
    }catch(error){this.db.close();throw error;}
   }
 }
 close(){this.textDb?.close();this.db.close();}
 session(scope:RetrievalScope,imageBudget=8):HistoricalEvidenceSession{
  if(!scope.recordingId||!Number.isFinite(scope.asOfMs)||!Number.isInteger(imageBudget)||imageBudget<0||imageBudget>24)throw Error('Archive requires recording/time scope and bounded image budget');
  const trusted={...scope};let searches=0,remaining=imageBudget;
   const allowed=new Map<string,Evidence>(),inspected=new Set<string>();const db=this.db,root=this.root,textDb=this.textDb;
  return {
   inspected,
    search(input:RetrievalQuery={}){
     input=calendarFilters(input,trusted.clock);
    if(++searches>12)throw Error('Retrieval search budget exceeded');
    const limit=input.limit??6,cursor=input.cursor??0;
    if(!Number.isInteger(limit)||limit<1||limit>24||!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid retrieval page');
    for(const t of [input.beforeMs,input.afterMs])if(t!==undefined&&!Number.isFinite(t))throw Error('Invalid time filter');
     if(input.placeId||(input.query?.trim()&&!textDb))return {status:'unknown',hits:[],nextCursor:null,remainingImages:remaining,note:'Raw archive has no semantic/identity index. Use time paging; an empty semantic result is not evidence of absence.',changes:[]};
     if(input.query?.trim()&&textDb){
      if(input.query.length>512||cursor!==0)throw Error('Text query budget exceeded; use time filters, not cursor');
      const tokens=input.query.match(/[\p{L}\p{N}_]+/gu)?.slice(0,16)??[];
      if(!tokens.length)return {status:'unknown',hits:[],nextCursor:null,remainingImages:remaining,changes:[],note:'No lexical query terms.'};
      const match=tokens.map(t=>'"'+t+'"').join(' OR ');
      const docs=textDb.prepare('SELECT d.observation_id,d.text,d.channel,d.provenance,bm25(terms) AS rank FROM terms JOIN documents d ON d.rowid=terms.rowid WHERE terms MATCH ? AND d.recording=? AND d.at_ms<? AND d.at_ms>=? ORDER BY rank,d.at_ms DESC,d.id LIMIT ?').all(match,trusted.recordingId!,Math.min(trusted.asOfMs,input.beforeMs??trusted.asOfMs),input.afterMs??0,limit) as Array<{observation_id:string;text:string;channel:string;provenance:string}>;
      const seen=new Set<string>();const hits=[];
      for(const doc of docs){
       if(seen.has(doc.observation_id))continue;seen.add(doc.observation_id);
       const row=db.prepare('SELECT raw FROM observations WHERE id=? AND session=? AND at_ms<? AND at_ms>=?').get(doc.observation_id,trusted.recordingId!,Math.min(trusted.asOfMs,input.beforeMs??trusted.asOfMs),input.afterMs??0) as {raw:string}|undefined;
       if(!row)throw Error('Auxiliary text references unavailable historical observation');
       const e=JSON.parse(row.raw) as Evidence;allowed.set(e.id,e);
       hits.push({id:e.id,atMs:e.atMs,sourceAtMs:e.atMs,recordingId:e.sessionId,placeId:null,reason:`Untrusted ${doc.channel} auxiliary text: ${doc.text}`,imageCount:3});
      }
      return {status:hits.length?'candidates':'unknown',hits,nextCursor:null,remainingImages:remaining,changes:[],note:'Local lexical auxiliary index, not official EgoRAG/Video-RAG or identity evidence. Verify original images before citing; absent results do not prove absence.'};
     }
    const rows=db.prepare('SELECT seq,raw FROM observations WHERE session=? AND at_ms<? AND at_ms>=? AND seq>? ORDER BY seq LIMIT ?').all(trusted.recordingId!,Math.min(trusted.asOfMs,input.beforeMs??trusted.asOfMs),input.afterMs??0,cursor,limit+1) as Array<{seq:number;raw:string}>;
    const selected=rows.slice(0,limit);const hits=selected.map(r=>{const e=JSON.parse(r.raw) as Evidence;allowed.set(e.id,e);return {id:e.id,atMs:e.atMs,sourceAtMs:e.atMs,recordingId:e.sessionId,placeId:null,reason:'Unclassified archived original evidence',imageCount:3};});
    return {status:hits.length?'candidates':'unknown',hits,nextCursor:rows.length>limit?selected.at(-1)!.seq:null,remainingImages:remaining,changes:[],note:'Raw evidence, including unclassified frames; no place identity or current-state claim. Strict historical cutoff.'};
   },
   async inspect(ids:string[]){
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!allowed.has(id)))throw Error('Inspect requires retrieved evidence IDs');
    if(ids.length*3>remaining)throw Error('Historical image budget exceeded');remaining-=ids.length*3;
    const mediaRoot=await realpath(join(root,'images'));
    const images=[];
    for(const id of ids){const e=allowed.get(id)!;for(const [index,view] of ['front','left','right'].entries()){
     const path=await realpath(resolve(root,e.cameras[view]!));const rel=relative(mediaRoot,path);
     if(rel.startsWith('..')||isAbsolute(rel)||!['.png','.jpg','.jpeg','.webp'].includes(extname(path).toLowerCase()))throw Error('Evidence path escapes media archive');
     if((await stat(path)).size>20*1024*1024)throw Error('Evidence image size budget exceeded');
     const bytes=await readFile(path);if(bytes.length>20*1024*1024||createHash('sha256').update(bytes).digest('hex')!==e.sha256[view])throw Error('Evidence integrity/budget failure');
     images.push({id,index,atMs:e.atMs,placeId:null,mimeType:extname(path).toLowerCase()==='.png'?'image/png':extname(path).toLowerCase()==='.webp'?'image/webp':'image/jpeg',data:bytes.toString('base64')});
    }}
    for(const id of ids)inspected.add(id);return images;
   },
   validateCitations(ids:string[],abstained=false){if(!Array.isArray(ids)||ids.some(id=>!inspected.has(id))||(!abstained&&!ids.length))throw Error('Answer needs inspected historical evidence');},
  };
 }
}

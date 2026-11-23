/** Tool contracts, not semantic judgments. null means an omitted optional field. */
export interface HistorySelection {
 query:string;cursor:number;placeId?:string;afterMs?:number;beforeMs?:number;
 strategy:'uniform'|'chronological';order:'asc'|'desc';
}
export class HistoryToolError extends Error {
 constructor(readonly code:string,message:string,readonly recovery:unknown){super(message);}
}
export function historySelection(raw:any,placeIds:string[]):HistorySelection {
 const cursor=raw.cursor??0;
 if(!Number.isSafeInteger(cursor)||cursor<0)throw new HistoryToolError('INVALID_CURSOR','cursor must be a nonnegative integer',{cursor:0});
 const query=raw.query??'';
 if(typeof query!=='string'||query.length>200)throw new HistoryToolError('INVALID_QUERY','query must be a short string',{kind:'browse',strategy:'uniform'});
 const result:HistorySelection={query:query.trim(),cursor,strategy:raw.strategy??'uniform',order:raw.order??'asc'};
 if(raw.placeId!=null){
  if(typeof raw.placeId!=='string'||!placeIds.includes(raw.placeId))throw new HistoryToolError('UNKNOWN_PLACE','Use an actual placeId from overview, or omit it',{allowedPlaceIds:placeIds,example:{kind:'browse',strategy:'uniform'}});
  result.placeId=raw.placeId;
 }
 for(const key of ['afterMs','beforeMs'] as const)if(raw[key]!=null){
  if(typeof raw[key]!=='number'||!Number.isFinite(raw[key]))throw new HistoryToolError('INVALID_TIME','Time filters are source milliseconds, or omitted',{kind:'overview'});
  result[key]=raw[key];
 }
 if(result.afterMs!==undefined&&result.beforeMs!==undefined&&result.afterMs>result.beforeMs)throw new HistoryToolError('INVALID_RANGE','afterMs must not exceed beforeMs',{kind:'overview'});
 if(!['uniform','chronological'].includes(result.strategy)||!['asc','desc'].includes(result.order))throw new HistoryToolError('INVALID_ORDER','Choose uniform/chronological and asc/desc',{strategy:'uniform',order:'asc'});
 return result;
}
/** Associate unlabeled frames to the nearest *known* place as a retrieval hint.
 * Never writes assignments or asserts that a camera remained in that place.
 */
export function temporalPlaceHints(rows:Array<{id:string;atMs:number;placeId:string|null}>){
 const labeled=rows.filter(r=>r.placeId);const hints=new Map<string,string>();let cursor=0;
 for(const row of rows){
  if(!labeled.length)break;
  while(cursor+1<labeled.length&&Math.abs(labeled[cursor+1]!.atMs-row.atMs)<Math.abs(labeled[cursor]!.atMs-row.atMs))cursor++;
  hints.set(row.id,row.placeId??labeled[cursor]!.placeId!);
 }
 return hints;
}

import type {Observation} from '../../assistant/spatial-memory/contracts.js';

/** Explicit replay clock, not capture time. Keep every original, including short tails. */
export function projectTwoSecondReplay(rows:Observation[]):Observation[]{
 if(!rows.length)return [];
 let atMs=rows[0]!.atMs;
 return rows.map((row,i)=>{
  if(i){const delta=row.atMs-rows[i-1]!.atMs;if(!Number.isFinite(delta)||delta<=0)throw Error('Nonchronological source clock');atMs+=Math.max(2000,delta*2);}
  return {...row,sourceAtMs:row.atMs,atMs};
 });
}

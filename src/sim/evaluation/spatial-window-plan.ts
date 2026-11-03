import type {Observation} from '../../assistant/spatial-memory/contracts.js';

/** Explicit replay clock, not capture time. Keep every original, including short tails. */
export function projectReplayClock(rows:Observation[],intervalMs=2000,sourceScale=2):Observation[]{
 if(!rows.length)return [];
 if(!Number.isInteger(intervalMs)||intervalMs<500||intervalMs>10000||!Number.isFinite(sourceScale)||sourceScale<=0)throw Error('Invalid replay clock');
 let atMs=rows[0]!.atMs;
 return rows.map((row,i)=>{
  if(i){const delta=row.atMs-rows[i-1]!.atMs;if(!Number.isFinite(delta)||delta<=0)throw Error('Nonchronological source clock');atMs+=Math.max(intervalMs,delta*sourceScale);}
  return {...row,sourceAtMs:row.atMs,atMs};
 });
}

/** Backwards-compatible 2-second projection. */
export function projectTwoSecondReplay(rows:Observation[]):Observation[]{
 return projectReplayClock(rows,2000,2);
}

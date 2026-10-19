/** Same 10s minimum age / 5s start interval / <=4 observations as v1.
 * Recording boundaries and end-of-input flush all remaining observations. */
export function spatialWindows<T extends {atMs:number;recordingId?:string}>(observations:T[]):T[][]{
 const windows:T[][]=[],pending:T[]=[];let started=-Infinity,previous:T|undefined;
 const flush=()=>{while(pending.length)windows.push(pending.splice(0,4));};
 for(const observation of observations){
  if(previous&&observation.atMs<previous.atMs)throw Error('Out-of-order replay');
  if(previous&&observation.recordingId!==previous.recordingId){flush();started=-Infinity;}
  pending.push(observation);
  if(observation.atMs-pending[0]!.atMs>=10000&&observation.atMs-started>=5000){windows.push(pending.splice(0,4));started=observation.atMs;}
  previous=observation;
 }
 flush();return windows;
}

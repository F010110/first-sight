/** Input-health gate, not spatial identity smoothing. Originals remain in the archive. */
export interface LiveFrame {id:string;requestWallTimeMs:number;atMs:number}
export class LiveFramePolicy<T extends LiveFrame>{
 private pending:T[]=[];
 private latest:T|undefined;
 private delivered:T|undefined;
 private lastAt=-Infinity;
 private continuityBroken=true;
 constructor(readonly maxAgeMs=2500,readonly maxGapMs=2500,readonly capacity=1){
  if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isFinite(maxGapMs)||maxGapMs<=0||!Number.isInteger(capacity)||capacity<1||capacity>4)throw Error('Invalid live frame policy');
 }
 offer(frame:T){
  if(!frame.id||!Number.isFinite(frame.requestWallTimeMs)||!Number.isFinite(frame.atMs)||frame.atMs<=this.lastAt)throw Error('Live source clock invalid or regressed');
  this.lastAt=frame.atMs;this.latest=frame;this.pending.push(frame);
  const removed=this.pending.length>this.capacity?this.pending.splice(0,this.pending.length-this.capacity).map(f=>f.id):[];
  if(removed.length)this.continuityBroken=true;
  return removed;
 }
 take(nowMs:number){
  const candidates=this.pending.splice(0),frame=candidates.at(-1);
  const supersededIds=candidates.slice(0,-1).map(f=>f.id);
  if(!frame)return {frame:null,reason:'no-pending-frame',supersededIds,continuity:'unknown'} as const;
  const age=nowMs-frame.requestWallTimeMs;
  if(!Number.isFinite(nowMs)||age<0||age>this.maxAgeMs){this.continuityBroken=true;return {frame:null,reason:age<0?'clock-invalid':'stale',archivedId:frame.id,supersededIds,continuity:'unknown'} as const;}
  const continuous=!this.continuityBroken&&!supersededIds.length&&!!this.delivered&&frame.atMs-this.delivered.atMs<=this.maxGapMs;
  this.delivered=frame;this.continuityBroken=false;
  return {frame,reason:'fresh',supersededIds,continuity:continuous?'sample-continuous':'unknown'} as const;
 }
 status(nowMs:number){
  const age=this.latest?nowMs-this.latest.requestWallTimeMs:Infinity;
  return {state:age>=0&&age<=this.maxAgeMs?'fresh-input':'current-state-unconfirmed',ageMs:Number.isFinite(age)?age:null,pending:this.pending.length};
 }
 /** Recheck when an asynchronous result finishes, not just when it was queued. */
 mayPublishCurrent(frame:T,nowMs:number){return this.latest?.id===frame.id&&nowMs>=frame.requestWallTimeMs&&nowMs-frame.requestWallTimeMs<=this.maxAgeMs;}
}

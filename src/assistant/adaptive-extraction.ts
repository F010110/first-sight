/** Local application cap, never an assertion about provider account quota. */
export class AdaptiveExtractionLimit{
 private limit=1;private changedAt=-Infinity;private holdUntil=0;
 constructor(private maximum:1|2=2,private eager=false){}
 choose(pending:number,oldestAgeMs:number,prepared:number,now:number){
  if(now<this.holdUntil)return this.limit;
  if(this.eager)return this.maximum;
  if(now-this.changedAt<15000)return this.limit;
  const target=pending>=4&&oldestAgeMs>=8000&&prepared<3?this.maximum:pending<4&&prepared===0?1:this.limit;
  if(target!==this.limit){this.limit=target;this.changedAt=now;}
  return this.limit;
 }
 congested(now:number){this.limit=1;this.changedAt=now;this.holdUntil=now+30000;}
}

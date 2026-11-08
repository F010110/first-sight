export type LaneTask={id:string;startMs:number;endMs:number;bytes:number;run:()=>Promise<void>};
export type LaneBudget={maxTasks:number;maxSpanMs:number;maxBytes:number};

/** A task stays admitted until its actual promise settles, including after failure.
 * No Promise.race timeout releases a still-running writer into a second writer. */
export class BoundedSerialLane{
 private queue:LaneTask[]=[];
 private active:LaneTask|null=null;
 private drain:Promise<void>|null=null;
 private stopped=false;
 private failures:Array<{id:string;error:string}>=[];
 constructor(private budget:LaneBudget){
  if(!Number.isInteger(budget.maxTasks)||budget.maxTasks<1||!Number.isFinite(budget.maxSpanMs)||budget.maxSpanMs<=0||!Number.isSafeInteger(budget.maxBytes)||budget.maxBytes<1)throw Error('Invalid finite lane budget');
 }
 admit(task:LaneTask):boolean{
  if(!task.id||!Number.isFinite(task.startMs)||!Number.isFinite(task.endMs)||task.startMs<0||task.endMs<task.startMs||!Number.isSafeInteger(task.bytes)||task.bytes<0)throw Error('Invalid lane task');
  const tasks=[...(this.active?[this.active]:[]),...this.queue,task];
  if(tasks.slice(0,-1).some(t=>t.id===task.id))throw Error('Duplicate active task');
  if(this.stopped||tasks.length>this.budget.maxTasks||tasks.reduce((n,t)=>n+t.bytes,0)>this.budget.maxBytes||Math.max(...tasks.map(t=>t.endMs))-Math.min(...tasks.map(t=>t.startMs))>this.budget.maxSpanMs)return false;
  this.queue.push(task);
  this.start();
  return true;
 }
 private start(){
  if(!this.drain&&!this.stopped&&this.queue.length)this.drain=Promise.resolve().then(()=>this.pump()).finally(()=>{this.drain=null;this.start();});
 }
 private async pump(){
  while(!this.stopped&&this.queue.length){
   const task=this.queue.shift()!;this.active=task;
   try{await task.run();}catch(error){this.failures.push({id:task.id,error:String(error)});this.stopped=true;}
   finally{this.active=null;}
  }
 }
 async idle(){while(this.drain)await this.drain;}
 status(){const tasks=[...(this.active?[this.active]:[]),...this.queue];return {active:this.active?.id??null,pending:tasks.length,bytes:tasks.reduce((n,t)=>n+t.bytes,0),spanMs:tasks.length?Math.max(...tasks.map(t=>t.endMs))-Math.min(...tasks.map(t=>t.startMs)):0,stopped:this.stopped,failures:structuredClone(this.failures)};}
}

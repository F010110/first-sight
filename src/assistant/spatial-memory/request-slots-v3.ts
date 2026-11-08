import type {V3Request} from './pi-session-v3.js';
import {setTimeout as sleep} from 'node:timers/promises';

/** No queue: two background lanes cannot consume the reserved question slot. */
export class V3RequestSlots{
 private active={perception:0,spatial:0,question:0};
 constructor(private cooldownMs=30000){if(!Number.isFinite(cooldownMs)||cooldownMs<0||cooldownMs>300000)throw Error('Invalid cooldown');}
 wrap(lane:keyof V3RequestSlots['active'],request:V3Request):V3Request{
  return async input=>{
   if(this.active[lane])throw Error('Concurrent request in '+lane+' lane forbidden');
   this.active[lane]++;
   try{
    try{return await request(input);}catch(error){
     if(lane==='question'||!/HTTP\s*429/.test(String(error)))throw error;
     // One extractor already runs serially. Keep that slot admitted during a
     // finite cooldown; never relaunch another background request beside it.
     await sleep(this.cooldownMs,undefined,input.signal?{signal:input.signal}:{});input.signal?.throwIfAborted();return await request(input);
    }
   }finally{this.active[lane]--;}
  };
 }
 status(){return {...this.active,reservedQuestionSlots:1};}
}

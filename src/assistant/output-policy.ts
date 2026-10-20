import type {Mode,OutputCandidate} from './contracts.js';

/** Browser text is one output channel. This policy has no TTS/audio dependency. */
export class OutputPolicy {
 private presented=new Map<string,number>();
 decide(candidate:OutputCandidate,state:{mode:Mode;outputPaused:boolean;cancelled:boolean},now:number){
  if(state.cancelled)return {deliver:false,reason:'task-cancelled'};
  if(candidate.expiresAtMs!==undefined&&candidate.expiresAtMs<now)return {deliver:false,reason:'expired'};
  if(candidate.action==='SILENT'||candidate.action==='DEFER')return {deliver:false,reason:candidate.action.toLowerCase()};
  if(state.outputPaused)return {deliver:false,reason:'output-interrupted'};
  if(!candidate.userInitiated&&(state.mode==='quiet'||state.mode==='daily')&&candidate.action!=='FAIL_NOTICE')return {deliver:false,reason:'mode-suppressed'};
  if(candidate.dedupeKey&&!candidate.userInitiated&&now-(this.presented.get(candidate.dedupeKey)??-Infinity)<30000)return {deliver:false,reason:'duplicate'};
  if(candidate.dedupeKey)this.presented.set(candidate.dedupeKey,now);
  if(this.presented.size>256)this.presented.delete(this.presented.keys().next().value!);
  return {deliver:true,reason:'allowed'};
 }
}

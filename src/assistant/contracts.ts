import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

export type Mode='daily'|'explore'|'focus'|'quiet';
export type CaptureState='stopped'|'recording'|'paused'|'error';
export type OutputAction='SILENT'|'SHORT'|'ANSWER'|'ASK'|'DEFER'|'FAIL_NOTICE';
export type TaskStatus='queued'|'running'|'completed'|'cancelled'|'failed';
export interface Message {id:string;role:'user'|'assistant';text:string;atMs:number;source:'user'|'conversation'|'visual'|'historical'|'system';sourceIds:string[];taskId?:string;action?:OutputAction}
export interface Task {id:string;text:string;capability:string;status:TaskStatus;createdAtMs:number;error?:string}
export interface OutputCandidate {action:OutputAction;text:string;source:Message['source'];sourceIds:string[];userInitiated:boolean;taskId?:string;expiresAtMs?:number;dedupeKey?:string}
export interface CapabilityResult {text:string;source:Message['source'];sourceIds:string[];abstained?:boolean}
export interface CapabilityContext {taskId:string;isCancelled:()=>boolean;draft?:string}
export interface Capability {id:string;title:string;available:boolean;reason?:string;requiresFreshObservation:boolean;execute(text:string,context:CapabilityContext):Promise<CapabilityResult>}
export interface Plan {capability:string;reply?:string}
export interface Planner {plan(text:string,history:Message[],capabilities:Array<{id:string;title:string;available:boolean}>):Promise<Plan>}
export interface ObservationService {
 observe(observation:SpatialObservation):Promise<void>;
 question(text:string,historical:boolean):Promise<CapabilityResult>;
 discardPending():void;
 close():void;
}
export interface Journal {append(kind:string,value:unknown):Promise<void>}
export interface AssistantView {
 sessionId:string;capture:CaptureState;mode:Mode;outputPaused:boolean;modelEnabled:boolean;
 messages:Message[];tasks:Task[];capabilities:Array<{id:string;title:string;available:boolean;reason?:string}>;
 latestObservation:{id:string;atMs:number;views:number;source:'manual-import';captureTimeKnown:false}|null;
 processing:number;lastError:string|null;
}

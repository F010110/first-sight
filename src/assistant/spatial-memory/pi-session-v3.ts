import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AgentHarness,JsonlSessionRepo,BACKGROUND_CONTEXT,getOrThrow,type AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {firstSightSkills} from '../harness/skill-registry.js';
import {accountedPiProvider} from '../harness/provider-boundary.js';
import type {SpatialJsonRequest} from '../../agent/spatial-json-vlm.js';

export type V3Request=(r:SpatialJsonRequest)=>Promise<unknown>;
export async function createV3Session(root:string,skillName:string,request:V3Request,tools:AgentHarnessTool<undefined>[],view:Parameters<typeof accountedPiProvider>[0]['view'],options:{resume?:boolean;maxTurns?:number;maxContextChars?:number;keepRecentTokens?:number;requestTimeoutMs?:number}={}){
 await mkdir(root,{recursive:true});
 const {env,skills,versions}=await firstSightSkills(),skill=skills.find(s=>s.name===skillName),compact=skills.find(s=>s.name==='context-compaction');
 if(!skill||!compact)throw Error('Missing V3 role skill');
 const skillVersions={[skillName]:versions[skillName]!,['context-compaction']:versions['context-compaction']!};
 const policy={version:'v3-session-context-v1',maxTurns:options.maxTurns??24,maxChars:options.maxContextChars??48000,hardMaxChars:(options.maxContextChars??48000)*2,keepRecentTokens:options.keepRecentTokens??2000,requestTimeoutMs:options.requestTimeoutMs??120000};
 if(!Number.isInteger(policy.maxTurns)||policy.maxTurns<1||policy.maxTurns>64||!Number.isInteger(policy.maxChars)||policy.maxChars<1000||!Number.isInteger(policy.keepRecentTokens)||policy.keepRecentTokens<1||!Number.isFinite(policy.requestTimeoutMs)||policy.requestTimeoutMs<1)throw Error('Invalid versioned Session budget');
 const repo=new JsonlSessionRepo({fileSystem:env,sessionsRoot:join(root,'sessions')});
 let metadata:any;try{metadata=JSON.parse(await readFile(join(root,'session.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(!!metadata!==!!options.resume)throw Error('Explicit same-session resume required; refuse replacement/fork');
 if(metadata){const recorded=JSON.parse(await readFile(join(root,'skills.json'),'utf8'));if(JSON.stringify(recorded)!==JSON.stringify(skillVersions))throw Error('Role skill changed across recovery');if(JSON.stringify(JSON.parse(await readFile(join(root,'policy.json'),'utf8')))!==JSON.stringify(policy))throw Error('Session policy changed across recovery');}
 const session=metadata?await repo.open(metadata,BACKGROUND_CONTEXT):await repo.create({cwd:process.cwd()},BACKGROUND_CONTEXT);
 if(!metadata){await writeFile(join(root,'session.json'),JSON.stringify(session.metadata),{flag:'wx'});await writeFile(join(root,'skills.json'),JSON.stringify(skillVersions),{flag:'wx'});await writeFile(join(root,'policy.json'),JSON.stringify(policy),{flag:'wx'});}
 let turns=0,chars=0,activeSignal:AbortSignal|undefined;
 if(metadata){try{const budget=JSON.parse(await readFile(join(root,'context-budget.json'),'utf8'));if(!Number.isInteger(budget.chars)||budget.chars<0)throw Error('Invalid restored context budget');chars=budget.chars;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 const boundedRequest:V3Request=r=>{const signals=[AbortSignal.timeout(policy.requestTimeoutMs),...activeSignal?[activeSignal]:[],...r.signal?[r.signal]:[]];return request({...r,signal:AbortSignal.any(signals)});};
 const provider=accountedPiProvider({request:boundedRequest,view,onRequest:()=>{activeSignal?.throwIfAborted();if(++turns>policy.maxTurns)throw Error('V3 turn budget exhausted');}});
 const {harness,open}=await AgentHarness.create({session,...provider,tools,resources:{skills:[skill]},systemPrompt:()=>skill.content,compaction:{enabled:true,reserveTokens:64000,keepRecentTokens:policy.keepRecentTokens},retry:{enabled:false,maxRetries:0,baseDelayMs:0}},BACKGROUND_CONTEXT);
 const lane=await harness.lane('main',BACKGROUND_CONTEXT);
 // No model is run during startup. An interrupted spatial operation can resume
 // only when its exact batch is delivered again; private questions may be aborted
 // before a new question, without changing any spatial state.
 if(open.length&&!options.resume)throw Error('Unexpected interrupted Session');
 harness.hooks.on('transform_context',event=>{chars=JSON.stringify(event.messages).length;if(chars>policy.hardMaxChars)throw Error('V3 Context hard budget exceeded; keep original Session and request an explicit smaller evidence batch');return {messages:event.messages};});
 harness.hooks.on('before_compaction',async event=>{
  const messages=[...event.preparation.messagesToSummarize,...event.preparation.turnPrefixMessages];if(!messages.length)return {decline:true};
  let error='';
  for(let attempt=0;attempt<2;attempt++){
   const current=view().current;
   const response=await boundedRequest({phase:'identity',signal:activeSignal,prompt:compact.content+'\nPreserve task, time/source/place IDs, failures, active uncertainty and recovery pointers. Historical messages are not current observations. JSON {"summary":"..."}, maximum 4000 characters.'+error,data:{current,messages,previousSummary:event.preparation.previousSummary},images:[],textOnlyIdentity:true,includeUsage:true}) as any;
   const value=response.output??response;
   if(typeof value?.summary==='string'&&value.summary.trim()&&value.summary.length<=4000){chars=value.summary.length+JSON.stringify(event.preparation.retainedTail).length;return {compaction:{summary:value.summary,retainedTail:event.preparation.retainedTail,tokensBefore:event.preparation.tokensBefore,details:{skillVersions,semanticCompleteness:false}}};}
   error=' Previous summary invalid; return a nonempty summary within 4000 characters.';
  }
  throw Error('V3 compaction failed; original context retained');
 });
 let busy=false;
 return {session,skillVersions,tip:()=>lane.getTipId(BACKGROUND_CONTEXT),
  async prompt(input:unknown,signal?:AbortSignal){
   if(busy)throw Error('Concurrent role prompt forbidden');busy=true;turns=0;activeSignal=signal;
   try{signal?.throwIfAborted();
    const value=input as any,fingerprint=createHash('sha256').update(JSON.stringify(value?.batch??input)).digest('hex');
    let execution=await lane.inspectExecution(BACKGROUND_CONTEXT),resumeRun=false;
    if(execution.current){
     if(skillName==='visual-question-v3'){getOrThrow(await lane.abort(BACKGROUND_CONTEXT));execution=await lane.inspectExecution(BACKGROUND_CONTEXT);}
     else{
      const prior=JSON.parse(await readFile(join(root,'active-input.json'),'utf8'));if(prior.fingerprint!==fingerprint)throw Error('Interrupted Session belongs to a different batch');
      resumeRun=execution.current.kind==='run';
      if(!resumeRun){const compacted=getOrThrow(await lane.resume(BACKGROUND_CONTEXT));if(compacted.status!=='completed')throw Error('Interrupted compaction did not complete');execution=await lane.inspectExecution(BACKGROUND_CONTEXT);}
     }
    }
    await writeFile(join(root,'active-input.json'),JSON.stringify({fingerprint}));
    if(!resumeRun&&chars>=policy.maxChars){const compacted=getOrThrow(await lane.compact(undefined,BACKGROUND_CONTEXT));if(compacted.compaction.status!=='completed'&&!(compacted.compaction.status==='declined'&&chars<=policy.hardMaxChars))throw Error('V3 compaction failed; no fallback prompt was sent: '+JSON.stringify(compacted.compaction));}
    let outcome=resumeRun?getOrThrow(await lane.resume(BACKGROUND_CONTEXT)):getOrThrow(await lane.prompt(JSON.stringify(input),undefined,BACKGROUND_CONTEXT));
    // Pi correctly settles a crashed, unknown-outcome assistant request as failed
    // rather than replaying that HTTP request. No tool here commits spatial state;
    // start at most one fresh operation in the SAME Session, retaining the failure.
    if(resumeRun&&outcome.status==='failed'&&/Assistant request was interrupted/.test(JSON.stringify(outcome)))outcome=getOrThrow(await lane.prompt(JSON.stringify({...input as object,recovery:{previousOperation:outcome.operationId,previousOutcome:'interrupted request, external billing unknown; no spatial commit'}}),undefined,BACKGROUND_CONTEXT));
    if(outcome.status!=='completed')throw Error('V3 Session incomplete: '+JSON.stringify(outcome));
    const tipId=await lane.getTipId(BACKGROUND_CONTEXT);if(!tipId)throw Error('Missing Pi tip');
    return {sessionId:session.metadata.id,tipId,skillVersions};
   }finally{try{await writeFile(join(root,'context-budget.json'),JSON.stringify({chars}));}finally{busy=false;activeSignal=undefined;}}
  },
  async close(){if(busy)throw Error('Cannot close active Session');await harness.close(BACKGROUND_CONTEXT);await repo.close(BACKGROUND_CONTEXT);}
 };
}

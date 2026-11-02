import {createModels,createProvider,envApiKeyAuth,type AssistantMessage,type ProviderStreams} from '@earendil-works/pi-ai';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import type {SpatialJsonRequest,SpatialJsonImage} from '../../agent/spatial-json-vlm.js';

/** JSON compatibility transport. Pi owns tool dispatch/session; existing boundary owns HTTP/accounting.
 * This is not native provider tool calling. Keep this explicit in every audit. */
export function accountedPiProvider(options:{request:(r:SpatialJsonRequest)=>Promise<unknown>;view:()=>{current:{id:string;atMs:number};runtimeContext:unknown;images:SpatialJsonImage[]};onRequest?:()=>void;onAssessment?:(text:string)=>void;singleToolArguments?:boolean}){
 const model={id:'qwen3.8-flash',name:'First-Sight accounted JSON bridge',api:'openai-completions' as const,provider:'first-sight-accounted',baseUrl:'http://accounted-boundary.invalid',reasoning:false,input:['text','image'] as ('text'|'image')[],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1600};
 const stream:ProviderStreams['streamSimple']=(target,context,streamOptions)=>{
  const events=createAssistantMessageEventStream();
  void (async()=>{
   const message:AssistantMessage={role:'assistant',content:[],api:target.api,provider:target.provider,model:target.id,stopReason:'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   events.push({type:'start',partial:{...message,content:[]}});
   try{
    streamOptions?.signal?.throwIfAborted();
    if(!context.tools?.length)throw Error('Unrouted summary request: use the application compaction skill boundary; no fallback provider call was sent');
    options.onRequest?.();const view=options.view();
    const messages=context.messages.map(m=>({role:m.role,...m.role==='toolResult'?{toolName:m.toolName,isError:m.isError}:{},content:typeof m.content==='string'?m.content:m.content.filter(b=>b.type!=='thinking'&&b.type!=='image')}));
    const response=await options.request({phase:'identity',prompt:context.systemPrompt??'',data:{current:view.current,role:'pi-harness',runtimeContext:view.runtimeContext,messages,tools:context.tools,transport:{singleToolArgumentsAllowed:options.singleToolArguments===true}},images:view.images,textOnlyIdentity:view.images.length===0,includeUsage:true}) as any;
    streamOptions?.signal?.throwIfAborted();
    const wire=response.output??response,usage=response.usage;
    // Explicit single-tool wire format: wrapping arguments adds no semantic fields,
    // guesses no target and repairs no sources. Pi still validates the full schema.
    const raw=options.singleToolArguments&&context.tools.length===1&&wire&&typeof wire==='object'&&!Array.isArray(wire)&&!('tool' in wire)&&!('arguments' in wire)?{tool:context.tools[0]!.name,arguments:wire}:wire;
    if(!usage||!Number.isFinite(usage.prompt_tokens)||!Number.isFinite(usage.completion_tokens))throw Error('Pi transport missing accounted usage');
    if(usage){message.usage.input=usage.prompt_tokens;message.usage.output=usage.completion_tokens;message.usage.totalTokens=usage.prompt_tokens+usage.completion_tokens;message.usage.cost={input:usage.prompt_tokens*.1356/1e6,output:usage.completion_tokens*.4584/1e6,cacheRead:0,cacheWrite:0,total:(usage.prompt_tokens*.1356+usage.completion_tokens*.4584)/1e6};}
    if(typeof raw.tool!=='string'||!raw.arguments||typeof raw.arguments!=='object'||!context.tools?.some(t=>t.name===raw.tool))throw Error('Invalid declared Pi tool call');
    if(raw.assessment!==undefined&&(typeof raw.assessment!=='string'||raw.assessment.length>600))throw Error('Invalid bounded assessment');
    if(raw.assessment)options.onAssessment?.(raw.assessment);
    message.content=[...raw.assessment?[{type:'text' as const,text:raw.assessment}]:[],{type:'toolCall',id:crypto.randomUUID(),name:raw.tool,arguments:raw.arguments}];message.stopReason='toolUse';
    events.push({type:'done',reason:'toolUse',message});events.end(message);
   }catch(error){message.stopReason=streamOptions?.signal?.aborted?'aborted':'error';message.errorMessage=String(error);events.push({type:'error',reason:message.stopReason,error:message});events.end(message);}
  })();return events;
 };
 const models=createModels();models.setProvider(createProvider({id:model.provider,name:model.name,auth:{apiKey:envApiKeyAuth('Boundary owned credentials',['QWEN_API_KEY'])},models:[model],api:{stream,streamSimple:stream}}));
 return {model,models};
}

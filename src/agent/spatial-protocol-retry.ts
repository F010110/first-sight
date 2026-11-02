/** Retry only model-output protocol failures; never retry transport/budget/auth failures here. */
export class SpatialOutputProtocolError extends Error{constructor(message:string){super(message);this.name='SpatialOutputProtocolError';}}
export async function boundedSpatialProtocol<T>(attempts:number,invoke:(feedback?:string)=>Promise<unknown>,validate:(value:unknown)=>T):Promise<T>{
 if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw Error('Invalid protocol retry bound');
 let feedback:string|undefined;
 for(let attempt=0;attempt<attempts;attempt++){
  let answer:unknown;
  try{answer=await invoke(feedback);}catch(error){if(!(error instanceof Error)||error.name!=='SpatialOutputProtocolError')throw error;if(attempt+1===attempts)throw error;feedback=protocolFeedback(error.message);continue;}
  try{return validate(answer);}catch(error){if(attempt+1===attempts)throw error;feedback=protocolFeedback(String(error));}
 }
 throw Error('Protocol attempts exhausted');
}
function protocolFeedback(reason:string){return `上次输出协议错误：${reason}。请重新查看本次交付的全部原图，返回完整且符合约束的JSON；不得机械补写引用、隐瞒视觉冲突或为了选中某组改变事实。无法唯一判定时明确不确定，禁止按新近程度强选。`;}

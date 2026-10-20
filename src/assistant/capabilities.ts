import type {Capability,ObservationService} from './contracts.js';

/** Product capability catalog. Unimplemented features are explicit, not fake successes. */
export function assistantCapabilities(memory:ObservationService,modelEnabled:boolean):Capability[]{
 const disabled='尚未启用真实模型。请以 --confirm-paid 启动并配置Qwen；当前只可验证控制、导入和界面。';
 return [
  {id:'conversation',title:'对话／解释',available:modelEnabled,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:false,async execute(_text,context){return {text:context.draft??'',source:'conversation',sourceIds:[]};}},
  {id:'visual.current',title:'查看当前导入图片',available:modelEnabled,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:true,async execute(text){return memory.question(text,false);}},
  {id:'memory.query',title:'查询本会话视觉记录',available:modelEnabled,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:false,async execute(text){return memory.question(text,true);}},
  ...[
   ['task.watch','持续关注任务'],['text.read','专门的文字读取'],['context.activity','活动情境推断'],['safety.alert','独立安全提示'],['privacy.erase','用户记忆删除']
  ].map(([id,title])=>({id:id!,title:title!,available:false,reason:'仅预留能力接口，本次未实现，不能承诺执行。',requiresFreshObservation:false,async execute(){throw Error('Not implemented');}})),
 ];
}

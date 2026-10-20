import type {Capability,ObservationService} from './contracts.js';

/** Product capability catalog. Unimplemented features are explicit, not fake successes. */
export function assistantCapabilities(memory:ObservationService,modelEnabled:boolean):Capability[]{
 const disabled='尚未启用真实模型。请以 --confirm-paid 启动并配置Qwen；当前只可验证控制、导入和界面。';
 return [
  {id:'conversation',title:'对话／解释',available:modelEnabled,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:false,async execute(_text,context){return {text:context.draft??'',source:'conversation',sourceIds:[]};}},
  {id:'visual.current',title:'查看当前输入画面',available:modelEnabled,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:true,async execute(text,context){return memory.question(`${text}\n仅作指代背景的对话（不是视觉证据；含助手未核实陈述）：${JSON.stringify(context.history??[])}`,false);}},
  {id:'memory.query',title:'查询本会话视觉记录',available:modelEnabled,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:false,async execute(text,context){return memory.question(`${text}\n仅作指代背景的对话（不是视觉证据；必须实际检索原图）：${JSON.stringify(context.history??[])}`,true);}},
  ...(['watch','find'] as const).map(kind=>({id:`task.${kind}`,title:kind==='watch'?'持续关注（两分钟）':'寻找目标（候选需确认）',available:modelEnabled&&!!memory.checkTarget,...!modelEnabled?{reason:disabled}:{},requiresFreshObservation:false,async execute(){return {text:kind==='watch'?'已建立关注，接下来两分钟在收到的新画面中检查；满足时提示一次。':'已开始寻找，接下来两分钟检查新画面；发现候选后需要你确认。',source:'system' as const,sourceIds:[]};}})),
  ...[
   ['text.read','专门的文字读取'],['context.activity','活动情境推断'],['safety.alert','独立安全提示'],['privacy.erase','用户记忆删除']
  ].map(([id,title])=>({id:id!,title:title!,available:false,reason:'仅预留能力接口，本次未实现，不能承诺执行。',requiresFreshObservation:false,async execute(){throw Error('Not implemented');}})),
 ];
}

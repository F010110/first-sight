/** Schema described as field types, not a JSON object full of copyable placeholders. */
export function fixedScopeCreationPrompt(currentId:string){
 if(!currentId.trim())throw Error('Missing current source ID');
 return `只根据CURRENT同一位置的三视图提出一个可修订的物理区域候选定义，不判断历史身份。若有独立当前perception，它也是当前图的候选解释，须用原图核对。不能把透门看见的房间当成观察者所在房间，也不能把没拍到的边界补成墙体。
返回一个JSON对象，只含以下三个字段：
coherent：布尔值，表示当前原图是否足以定义具体所在区域；看不清或有互相冲突解释时为false。
scope：coherent=false时为null；true时为对象，恰含name、definition、boundaryRules、sourceIds。
  name：用当前可见事实写简短地点名，不是官方名称，不推断废弃、地下或建筑用途。
  definition：写实际可见的观察者可占据区域和边界关系，400字以内，不能返回字段说明或占位词。
  boundaryRules：1到4个字符串，描述原图支持的邻接区域排除规则，每项240字以内；不能把遮挡未知当成确定墙体，不能声称看不到的路径不能互通。
  sourceIds：必须恰为${JSON.stringify([currentId])}，不要输出任何占位ID。
reason：用实际原图事实简述建立或不建立候选的依据。
所有字符串写本次图像的实际内容；只输出JSON，不输出格式示例或字段类型说明。此处没有提供地点名称或正确区域标签。`;
}

/** Experimental identity-free current perception and explicit identity actions.
 * Protocol checks are not a visual truth judge. */
export interface SpatialPerception {observationId:string;region:string;clearRegion:boolean;layoutEvidence:string[];uncertainties:string[];retrievalQueries:string[];sourceIds:string[]}
export interface SpatialReference {id:string;atMs:number;role:'previous'|'anchor'|'retrieved';hasIdentity:boolean}
export interface SpatialIdentityAction {action:'continue'|'establish_candidate'|'revisit'|'unknown';referenceId:string|null;reason:string;comparisons:Array<{referenceId:string;relation:'same'|'different'|'uncertain';evidence:string}>;sourceIds:string[]}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=240);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
export function parseSpatialPerception(value:unknown,id:string):SpatialPerception{
 if(!object(value)||!keys(value,['observationId','region','clearRegion','layoutEvidence','uncertainties','retrievalQueries','sourceIds'])||value.observationId!==id||typeof value.region!=='string'||!value.region.trim()||value.region.length>160||typeof value.clearRegion!=='boolean'||!strings(value.layoutEvidence)||value.layoutEvidence.length>4||!strings(value.uncertainties)||value.uncertainties.length>4||!strings(value.retrievalQueries)||value.retrievalQueries.length>2||value.retrievalQueries.some(q=>q.length>16)||!Array.isArray(value.sourceIds)||value.sourceIds.length!==1||value.sourceIds[0]!==id)throw Error('Perception needs only current observationId/region/clearRegion/layoutEvidence/uncertainties/retrievalQueries/sourceIds; no identity or history fields.');
 if(value.clearRegion&&value.layoutEvidence.length<2)throw Error('A clear region needs at least two visible layout facts, not a name alone.');
 return structuredClone(value) as unknown as SpatialPerception;
}
export function parseSpatialIdentityAction(value:unknown,id:string,references:SpatialReference[],perception:SpatialPerception):SpatialIdentityAction{
 if(!object(value)||!keys(value,['action','referenceId','reason','comparisons','sourceIds'])||!['continue','establish_candidate','revisit','unknown'].includes(String(value.action))||(value.referenceId!==null&&typeof value.referenceId!=='string')||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>400||!Array.isArray(value.comparisons)||!strings(value.sourceIds)||!value.sourceIds.includes(id))throw Error('Identity action needs action/referenceId/reason/comparisons/sourceIds only; UUIDs are runtime-owned.');
 const refs=new Map(references.map(r=>[r.id,r]));const seen=new Set<string>();
 for(const c of value.comparisons){
  if(!object(c)||!keys(c,['referenceId','relation','evidence'])||typeof c.referenceId!=='string'||!refs.has(c.referenceId)||seen.has(c.referenceId)||!['same','different','uncertain'].includes(String(c.relation))||typeof c.evidence!=='string'||!c.evidence.trim()||c.evidence.length>240||!value.sourceIds.includes(c.referenceId))throw Error('Compare every delivered reference once with exact ID, relation, visible layout evidence and source citation.');
  seen.add(c.referenceId);
 }
 if(seen.size!==refs.size||value.sourceIds.some(source=>source!==id&&!refs.has(source)))throw Error('Missing comparison or undelivered source.');
 const action=value as unknown as SpatialIdentityAction,previous=references.find(r=>r.role==='previous');
 const relation=(id:string)=>action.comparisons.find(c=>c.referenceId===id)?.relation;
 if(action.action==='continue'||action.action==='revisit'){
  const target=action.referenceId?refs.get(action.referenceId):null;
  if(!target?.hasIdentity||relation(target.id)!=='same'||!perception.clearRegion)throw Error('Reuse requires clear current region and same comparison to an inspected reference with an identity.');
  if(action.action==='continue'&&target.role!=='previous')throw Error('continue must point to the immediate previous observation in this recording.');
 }else if(action.referenceId!==null)throw Error('establish_candidate/unknown must not choose an old reference ID.');
 if(action.action==='establish_candidate'){
  if(!perception.clearRegion)throw Error('Establish a local candidate only from a clearly observed region.');
  if(previous&&(relation(previous.id)==='uncertain'||previous.hasIdentity&&relation(previous.id)!=='different'))throw Error('Candidate requires positive difference from the active region; uncertainty is not a boundary.');
  if(references.some(r=>r.hasIdentity&&relation(r.id)==='same'))throw Error('An inspected same-region identity must not be duplicated with a new candidate.');
 }
 return structuredClone(action);
}

export const independentPerceptionPrompt='仅描述CURRENT同一时刻的三视图所示观察者所在区域，不判断地点身份，不推断历史、不生成UUID。区分脚下可占据区域和隔围栏/门口可见的区域；画面里有球架不等于在球场。依据地面、边界哪一侧、开口、墙/围栏/通路相对关系描述，不仅列物体。看不清则clearRegion=false并说明。只输出JSON：{"observationId":"CURRENT准确ID","region":"简短所在区域","clearRegion":true,"layoutEvidence":["可见布局事实1","可见布局事实2"],"uncertainties":[],"retrievalQueries":["当前可见地标短关键词，最多两个，每个16字内"],"sourceIds":["CURRENT准确ID"]}。不含任何其他字段，尤其不含placeId、action、历史判断。';
export const explicitIdentityPrompt='根据CURRENT原图和独立当前感知，与REFERENCE原图逐项比较具体所在区域。旧身份只以hasIdentity标记，UUID由程序绑定，不输出UUID。角色previous为本段紧邻上次观察，anchor为该身份较早代表，retrieved为实际历史检索来源。共享墙、围栏或物体不证明同地；比较围栏哪一侧、脚下区域、开口和布局。转向/光照不自动换区，也不能仅按时间连续合并。different必须是具体布局的正面冲突；视角遮挡看不到足够共同布局只表示uncertain，不等于different。若所选身份的其他参考图存在different冲突，不能忽略它继续沿用；先重新核对，仍有冲突则unknown。仅一个原图支持same而其他图uncertain，只形成单参考候选延续，不是多参考确认。只输出JSON：{"action":"continue或establish_candidate或revisit或unknown","referenceId":null,"reason":"简短依据","comparisons":[{"referenceId":"每个准确REFERENCE ID各一项","relation":"same或different或uncertain","evidence":"具体布局依据"}],"sourceIds":["CURRENT及所有比较REFERENCE ID"]}。continue选择previous且hasIdentity=true、关系same；revisit选择实际看过且hasIdentity=true的来源、关系same。establish_candidate表示建立本地可修订候选，不声称世界中首次来过，也不要求知道建筑名；clearRegion=true且与active previous有正面不同证据时可以建立，或首次无previous时根据可见布局建立。previous身份未知但可见同一清楚区域时也可首次建立候选，不要因没有旧UUID一直unknown。已看过的同区身份存在时不得重复建立。unknown表示布局或身份关联确实不足，不能以缺旧UUID代替空间判断。establish_candidate/unknown的referenceId=null。references为空时comparisons=[]。当前感知不可从历史图补出不可见细节；不能把未记录间隙当作连续移动。';

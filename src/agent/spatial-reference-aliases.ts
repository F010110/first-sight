import type {SpatialJsonRequest} from './spatial-json-vlm.js';
type Binding={alias:string;originalId:string;kind:'source'|'group'};
const scalarIds=new Set(['id','observationId','currentId','referenceId','groupId','selectedGroupId']);
const arrayIds=new Set(['sourceIds','memberIds']);
/** Request-local aliases are opaque references, never semantic identity repairs.
 * Full bindings are journal metadata, not additional VLM evidence. Unknown IDs fail. */
export function aliasedSpatialRequest(request:(input:SpatialJsonRequest)=>Promise<unknown>){
 return async(input:SpatialJsonRequest)=>{
  const sources=new Set(input.images.map(i=>i.id)),groups=new Set<string>();
  const collect=(value:unknown,key='')=>{
   if(Array.isArray(value)){
    if(arrayIds.has(key)){for(const id of value){if(typeof id!=='string')throw Error('Invalid source ID array');sources.add(id);}}
    else for(const v of value)collect(v);
    return;
   }
   if(!value||typeof value!=='object')return;
   const row=value as Record<string,unknown>;
   if(typeof row.groupId==='string')groups.add(row.groupId);
   if(key==='groups'&&typeof row.id==='string')groups.add(row.id);
   for(const [k,v] of Object.entries(row)){
    if(k==='groups'&&Array.isArray(v)){for(const g of v){if(g&&typeof g==='object'&&typeof (g as any).id==='string')groups.add((g as any).id);collect(g);}continue;}
    if(scalarIds.has(k)&&typeof v==='string'&&k!=='groupId'&&k!=='selectedGroupId')sources.add(v);
    collect(v,k);
   }
  };
  collect(input.data);for(const id of groups)sources.delete(id);
  const originals=new Set([...sources,...groups]);const bindings:Binding[]=[];
  for(const [kind,ids,prefix] of [['source',sources,'S'],['group',groups,'G']] as const){let i=0;for(const originalId of ids){let alias:string;do{alias=prefix+i++;}while(originals.has(alias));bindings.push({alias,originalId,kind});}}
  const encode=new Map(bindings.map(b=>[b.originalId,b.alias])),decode=new Map(bindings.map(b=>[b.alias,b.originalId]));
  const transform=(value:unknown,mapping:Map<string,string>,strict:boolean,key=''):unknown=>{
   if(typeof value==='string'&&(scalarIds.has(key)||arrayIds.has(key))){const id=mapping.get(value);if(!id&&strict)throw Error(`Unknown model reference alias: ${value}`);return id??value;}
   if(Array.isArray(value))return value.map(v=>transform(v,mapping,strict,arrayIds.has(key)?key:''));
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v,mapping,strict,k)]));
   return value;
  };
  let prompt=input.prompt;
  for(const binding of [...bindings].sort((a,b)=>b.originalId.length-a.originalId.length)){
   const escaped=binding.originalId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   prompt=prompt.replace(new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`,'g'),binding.alias);
  }
  const answer=await request({...input,prompt,data:transform(input.data,encode,false),images:input.images.map(i=>({...i,id:encode.get(i.id)!})),metadata:{referenceBindings:bindings}});
  return transform(answer,decode,true);
 };
}

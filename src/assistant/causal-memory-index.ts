import type {MemoryEntry} from './causal-context-question.js';

export type MemoryBlock={blockId:string;firstMs:number;lastMs:number;count:number;representatives:MemoryEntry[]};
/** Fixed clock buckets are retrieval pages, NOT places, visits or reference segmentation. */
export function causalMemoryBlocks(rows:MemoryEntry[]):MemoryBlock[]{
 const buckets=new Map<number,MemoryEntry[]>();
 for(const r of rows){const key=Math.floor(r.atMs/20000);const items=buckets.get(key)??[];items.push(r);buckets.set(key,items);}
 return [...buckets].sort((a,b)=>a[0]-b[0]).map(([key,items])=>{
  items.sort((a,b)=>a.atMs-b.atMs);
  const representatives=[...new Set([0,Math.floor((items.length-1)/2),items.length-1])].map(i=>items[i]!);
  return {blockId:`time-block-${key}`,firstMs:items[0]!.atMs,lastMs:items.at(-1)!.atMs,count:items.length,representatives};
 });
}
const stop=new Set('的了是在和与有这那我们之前刚才一个里面什么地方能看到'.split(''));
function tokens(text:string){
 const parts=text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g)??[];
 return [...new Set([...parts.filter(t=>!stop.has(t)),...parts.slice(1).map((v,i)=>parts[i]+v).filter(t=>![...t].every(c=>stop.has(c)))])];
}
export function diverseMemorySearch(rows:MemoryEntry[],query:string,afterMs=0,beforeMs=Infinity){
 if(typeof query!=='string'||!query.trim()||query.length>200||!Number.isFinite(afterMs)||!(Number.isFinite(beforeMs)||beforeMs===Infinity)||afterMs>beforeMs)throw Error('Invalid memory query');
 const terms=tokens(query),eligible=rows.filter(r=>r.atMs>=afterMs&&r.atMs<=beforeMs);
 const df=new Map(terms.map(t=>[t,eligible.filter(r=>r.text.toLowerCase().includes(t)).length]));
 const ranked=eligible.map(r=>({r,score:terms.reduce((n,t)=>n+(r.text.toLowerCase().includes(t)?(t.length>1?3:1)*Math.log(1+eligible.length/(1+df.get(t)!)):0),0)}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.r.atMs-b.r.atMs);
 const selected:MemoryEntry[]=[],seen=new Set<number>();
 for(const {r} of ranked){const block=Math.floor(r.atMs/20000);if(seen.has(block))continue;seen.add(block);selected.push(r);if(selected.length===8)break;}
 return selected;
}

/** Detect a narrow set of explicit movement assurances, not a general safety classifier. */
export function explicitMovementAssurance(text:string){
 return text.split(/[。！？；\n]/).filter(clause=>{
  const tail=clause.split(/但是|不过|但/).at(-1)!;
  return /可以直接(?:走|进|过|通行)|放心(?:走|进|过)|绝对安全|肯定安全|保证安全|无需(?:探路|确认|检查)/.test(tail)
   &&!/(?:不能|无法|不可|不保证|不建议|不确定|不要|并非).{0,12}(?:可以直接|放心|安全|无需)/.test(tail);
 });
}

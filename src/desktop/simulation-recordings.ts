import {readFile,readdir,realpath,lstat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const validId=(id:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id);
type View='front'|'left'|'right';
type Frame={id:string;atMs:number;views:Array<{view:View;path:string;sha256:string}>};
async function publicRoot(root:string,id:string){
 if(!validId(id))throw Error('Invalid simulation id');
 const path=join(resolve(root),id,'public');
 if((await lstat(path)).isSymbolicLink())throw Error('Simulation public directory cannot be a symlink');
 const actual=await realpath(path),base=await realpath(root),rel=relative(base,actual);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('Simulation path outside archive');
 return actual;
}
export async function readSimulation(root:string,id:string){
 const base=await publicRoot(root,id),raw=await readFile(join(base,'manifest.json'),'utf8'),manifest=JSON.parse(raw);
 if(manifest.schema!=='three-view-render-input-v1'||manifest.scoreEligible!==false)throw Error('Unsupported simulation manifest');
 const text=await readFile(join(base,'observations.jsonl'),'utf8');if(text.length>16000000)throw Error('Simulation index too large');
 const rows=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 if(!rows.length||rows.length>20000||rows.length!==manifest.observations)throw Error('Incomplete simulation package');
 const frames:Frame[]=[];let last=-Infinity;const ids=new Set<string>();
 for(const row of rows){
  if(typeof row.id!=='string'||!validId(row.id)||ids.has(row.id)||!Number.isFinite(row.sourceAtMs)||row.sourceAtMs<0||row.sourceAtMs<=last||!Array.isArray(row.frames)||!row.frames.length)throw Error('Invalid simulation observation');
  ids.add(row.id);last=row.sourceAtMs;
  const views:Frame['views']=[];
  for(const v of row.frames){
   if(!['front','left','right'].includes(v.view)||views.some(x=>x.view===v.view)||typeof v.path!=='string'||!/^frames\/[a-zA-Z0-9_-]+\.(png|jpg)$/.test(v.path)||!/^[a-f0-9]{64}$/.test(v.sha256))throw Error('Invalid simulation image binding');
   views.push({view:v.view,path:v.path,sha256:v.sha256});
  }
  if(!views.some(v=>v.view==='front')||new Set(views.map(v=>v.path)).size!==views.length||new Set(views.map(v=>v.sha256)).size!==views.length)throw Error('Missing front or duplicated simulation views');
  frames.push({id:row.id,atMs:row.sourceAtMs,views});
 }
 return {id,title:typeof manifest.title==='string'?manifest.title:'ReplicaCAD · 三摄渲染验证',scope:typeof manifest.scope==='string'?manifest.scope:'技术渲染小样本；非10分钟生活事件或空间准确率验收',clock:'synthetic',readOnly:true,frames,
  provenance:{source:'ReplicaCAD',synthetic:true,hardwareCalibration:false,modelCalls:0,scoreEligible:false},base};
}
export async function listSimulations(root:string){
 let entries;try{entries=await readdir(root,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 const result=[];
 for(const entry of entries){if(!entry.isDirectory()||!validId(entry.name))continue;
  try{const sample=await readSimulation(root,entry.name);result.push({id:sample.id,title:sample.title,scope:sample.scope,frames:sample.frames.length,durationMs:sample.frames.at(-1)!.atMs-sample.frames[0]!.atMs});}
  catch{/* A partial/failed generation is not a ready replay. Preserve its files. */}
 }
 return result.sort((a,b)=>a.id.localeCompare(b.id));
}
export async function simulationImage(root:string,id:string,observationId:string,view:string){
 const sample=await readSimulation(root,id),binding=sample.frames.find(f=>f.id===observationId)?.views.find(v=>v.view===view);
 if(!binding)throw Error('Unknown simulation image');
 const path=await realpath(resolve(sample.base,binding.path)),rel=relative(sample.base,path);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('Simulation image outside public package');
 const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==binding.sha256)throw Error('Simulation original changed');
 return {bytes,type:binding.path.endsWith('.png')?'image/png':'image/jpeg'};
}

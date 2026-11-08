import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {PlaceMatcher,RevisitImage,RevisitMatchEntry,RevisitMatchResult} from './revisit-candidates.js';

/** Offline SIFT+RANSAC bridge. Unavailable tooling means "no candidates", never "never visited". */
export function imageMatchPlaceMatcher(script=resolve('scripts','media','image_match.py'),options:{timeoutMs?:number;maxDim?:number;minInliers?:number;python?:string}={}):PlaceMatcher{
 const python=()=>[options.python,process.env.VLM_PYTHON,process.platform==='win32'?resolve('.venv','Scripts','python.exe'):resolve('.venv','bin','python'),'python3','python'].filter((v):v is string=>!!v).find(v=>v==='python'||v==='python3'||existsSync(v))??'python';
 return {async match(current,candidates){
  if(!current.length||!candidates.length)return {ok:true,best:null,nearest:null,results:[]};
  if(!existsSync(script))return {ok:false,best:null,nearest:null,results:[],error:'image matcher script not found'};
  const payload=JSON.stringify({queries:current.map(i=>i.path),candidates:candidates.map(c=>({id:c.placeId,path:c.image.path})),minInliers:options.minInliers??20,maxDim:options.maxDim??640,ratio:0.75,cache:true});
  return await new Promise<RevisitMatchResult>(resolvePromise=>{
   let child;try{child=spawn(python(),[script],{stdio:['pipe','pipe','pipe']});}catch(error){resolvePromise({ok:false,best:null,nearest:null,results:[],error:String(error)});return;}
   let out='',err='',settled=false;const finish=(value:RevisitMatchResult)=>{if(!settled){settled=true;resolvePromise(value);}};
   const timer=setTimeout(()=>{try{child!.kill();}catch{}finish({ok:false,best:null,nearest:null,results:[],error:'image matcher timed out'});},options.timeoutMs??20000);
   child.stdout.on('data',chunk=>{out+=String(chunk);});child.stderr.on('data',chunk=>{err+=String(chunk);});
   child.on('error',error=>{clearTimeout(timer);finish({ok:false,best:null,nearest:null,results:[],error:error.message});});
   child.on('close',()=>{
    clearTimeout(timer);const line=out.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if(!line){finish({ok:false,best:null,nearest:null,results:[],error:err.trim()||'empty image matcher output'});return;}
    try{
     const parsed=JSON.parse(line) as {ok?:boolean;best?:any|null;nearest?:any|null;results?:any[];error?:string};
     if(typeof parsed.ok!=='boolean'||!Array.isArray(parsed.results))throw Error('malformed image matcher response');
      const byPath=new Map(candidates.map(c=>[c.placeId+'\0'+c.image.path,c.image.id]));
      const convert=(entry:any):RevisitMatchEntry|null=>{const observationId=typeof entry?.path==='string'&&typeof entry?.id==='string'?byPath.get(entry.id+'\0'+entry.path):undefined;if(!observationId)return null;return {...entry,placeId:entry.id,observationId};};
     const results=parsed.results.map(convert).filter((e):e is RevisitMatchEntry=>!!e);
     // A failed matcher is reported as unavailable, not an empty result.
     finish({ok:parsed.ok,best:convert(parsed.best),nearest:convert(parsed.nearest),results,...parsed.error?{error:parsed.error}:{}});
    }catch(error){finish({ok:false,best:null,nearest:null,results:[],error:'image matcher output invalid: '+String(error)});}
   });
   child.stdin.on('error',()=>{});child.stdin.write(payload);child.stdin.end();
  });
 }};
}

/** Persistent bounded index. One process/index, one in-flight request and a finite deadline. */
export function imageIndexPlaceMatcher(script=resolve('scripts','media','image_index.py'),options:{imagesPerPlace?:number;shortlistPlaces?:number;siftImagesPerPlace?:number;minInliers?:number;maxDim?:number;ratio?:number;python?:string;timeoutMs?:number}={}):PlaceMatcher{
 const python=()=>[options.python,process.env.VLM_PYTHON,process.platform==='win32'?resolve('.venv','Scripts','python.exe'):resolve('.venv','bin','python'),'python3','python'].filter((v):v is string=>!!v).find(v=>v==='python'||v==='python3'||existsSync(v))??'python';
 let child:ChildProcessWithoutNullStreams|null=null,sequence=0;
  const pending=new Map<number,{resolve:(value:RevisitMatchResult)=>void;candidates:Array<{placeId:string;image:RevisitImage}>;timer:ReturnType<typeof setTimeout>}>();
  const finishAll=(error:string)=>{for(const item of pending.values()){clearTimeout(item.timer);item.resolve({ok:false,best:null,nearest:null,results:[],error});}pending.clear();};
 const start=()=>{
  if(child)return child;
  const process=spawn(python(),[script],{stdio:['pipe','pipe','pipe']});child=process;
  const lines=createInterface({input:process.stdout});
  lines.on('line',line=>{
   let raw:any;try{raw=JSON.parse(line);}catch{return;}
    const waiting=pending.get(raw?.id);if(!waiting)return;pending.delete(raw.id);clearTimeout(waiting.timer);
   if(raw?.ok!==true){waiting.resolve({ok:false,best:null,nearest:null,results:[],error:String(raw?.error??'image index unavailable'),...raw?.stats?{stats:raw.stats}:{}});return;}
    const byPath=new Map(waiting.candidates.map(c=>[c.placeId+'\0'+c.image.path,c.image.id]));
   const convert=(entry:any):RevisitMatchEntry|null=>{
     const observationId=typeof entry?.path==='string'&&typeof entry?.id==='string'?byPath.get(entry.id+'\0'+entry.path):undefined;
    if(!observationId||typeof entry?.id!=='string')return null;
    return {...entry,placeId:entry.id,observationId};
   };
   const results=(Array.isArray(raw.results)?raw.results:[]).map(convert).filter((entry:RevisitMatchEntry|null):entry is RevisitMatchEntry=>!!entry);
   waiting.resolve({ok:true,best:convert(raw.best),nearest:convert(raw.nearest),results,...raw.stats?{stats:raw.stats}:{}});
  });
   process.on('error',error=>{if(child===process){finishAll(error.message);child=null;}});
   process.on('close',()=>{if(child===process){finishAll('image index process exited');child=null;}});
   process.stdin.on('error',error=>{if(child===process){finishAll(error.message);child=null;try{process.kill();}catch{}}});
  process.stderr.on('data',()=>{});
  return process;
 };
 return {
   async match(current,candidates){
    if(pending.size)return {ok:false,best:null,nearest:null,results:[],error:'image index already has an in-flight request'};
   if(!current.length||!candidates.length)return {ok:true,best:null,nearest:null,results:[]};
   if(!existsSync(script))return {ok:false,best:null,nearest:null,results:[],error:'image index script not found'};
   const places=new Map<string,{placeId:string;name:string;members:Array<{observationId:string;atMs:number;path:string;direction:string}>}>();
   for(const candidate of candidates){
    const entry=places.get(candidate.placeId)??{placeId:candidate.placeId,name:candidate.placeId,members:[]};
    entry.members.push({observationId:candidate.image.id,atMs:0,path:candidate.image.path,direction:candidate.image.direction});
    places.set(candidate.placeId,entry);
   }
   const process=start(),id=++sequence;
   return await new Promise<RevisitMatchResult>(resolve=>{
     const timer=setTimeout(()=>{if(child===process){finishAll('image index request deadline exceeded');child=null;try{process.kill();}catch{}}},options.timeoutMs??20000);
     pending.set(id,{resolve,candidates,timer});
    process.stdin.write(JSON.stringify({op:'match',id,queries:current.map(image=>({path:image.path})),places:[...places.values()],imagesPerPlace:options.imagesPerPlace??4,shortlistPlaces:options.shortlistPlaces??8,siftImagesPerPlace:options.siftImagesPerPlace??2,minInliers:options.minInliers??20,maxDim:options.maxDim??640,ratio:options.ratio??0.75})+ '\n');
   });
  },
  async close(){
    const process=child;finishAll('image index closed');if(!process)return;child=null;
   try{process.stdin.write(JSON.stringify({op:'close'})+ '\n');}catch{}
   await new Promise<void>(resolve=>{const timer=setTimeout(()=>{try{process.kill();}catch{}resolve();},1000);process.once('close',()=>{clearTimeout(timer);resolve();});});
  }
 };
}

/** Current-window sentinel for tests without the native matcher. */
export function unavailablePlaceMatcher(error='visual matcher not configured'):PlaceMatcher{
 return {async match(){return {ok:false,best:null,nearest:null,results:[],error};}};
}

export type {RevisitImage};

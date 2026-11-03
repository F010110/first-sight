import {spawn} from 'node:child_process';
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
     const byPath=new Map(candidates.map(c=>[c.image.path,c.image.id]));
     const convert=(entry:any):RevisitMatchEntry|null=>{const observationId=typeof entry?.path==='string'?byPath.get(entry.path):undefined;if(!observationId||typeof entry.id!=='string')return null;return {...entry,placeId:entry.id,observationId};};
     const results=parsed.results.map(convert).filter((e):e is RevisitMatchEntry=>!!e);
     // A failed matcher is reported as unavailable, not an empty result.
     finish({ok:parsed.ok,best:convert(parsed.best),nearest:convert(parsed.nearest),results,...parsed.error?{error:parsed.error}:{}});
    }catch(error){finish({ok:false,best:null,nearest:null,results:[],error:'image matcher output invalid: '+String(error)});}
   });
   child.stdin.on('error',()=>{});child.stdin.write(payload);child.stdin.end();
  });
 }};
}

/** Current-window sentinel for tests without the native matcher. */
export function unavailablePlaceMatcher(error='visual matcher not configured'):PlaceMatcher{
 return {async match(){return {ok:false,best:null,nearest:null,results:[],error};}};
}

export type {RevisitImage};

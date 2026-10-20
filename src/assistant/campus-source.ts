import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export interface CampusFrame {id:string;atMs:number;sourceAtMs:number;episodeNumber:number;cameras:Record<string,string>;sha256:Record<string,string>}
const directions=['front','left','right'] as const;
/** Input-only projection: never load annotations, answers, old predictions or GT poses. */
export class CampusSource {
 private constructor(private readonly rows:CampusFrame[],readonly manifestSha256:string){}
 get length(){return this.rows.length;}
 time(index:number){const row=this.rows[index];if(!row)throw Error('Campus frame out of range');return row.atMs;}
 async read(index:number){
  const row=this.rows[index];if(!row)throw Error('Campus frame out of range');
  const views=[];
  for(const direction of directions){
   const path=row.cameras[direction]!,bytes=await readFile(path);
   if(createHash('sha256').update(bytes).digest('hex')!==row.sha256[direction])throw Error(`Campus original hash mismatch: ${row.id}/${direction}`);
   if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Campus source requires original PNG');
   views.push({direction,path,bytes,sha256:row.sha256[direction]!,mime:'image/png'});
  }
  return {id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,episodeNumber:row.episodeNumber,views};
 }
 static async load(path:string){
  const raw=await readFile(path,'utf8');const ids=new Set<string>();let last=-Infinity;
  const rows:CampusFrame[]=raw.trim().split(/\r?\n/).map(line=>{
   const value=JSON.parse(line);
   if(typeof value.id!=='string'||!value.id||ids.has(value.id)||!Number.isFinite(value.atMs)||value.atMs<=last||!Number.isFinite(value.sourceAtMs)||!Number.isInteger(value.episodeNumber)||value.episodeNumber<1)throw Error('Invalid campus timeline');
   const cameras:Record<string,string>={},sha256:Record<string,string>={};
   for(const direction of directions){
    if(typeof value.cameras?.[direction]!=='string'||!value.cameras[direction]||!/^([a-f0-9]{64})$/.test(value.sha256?.[direction]??''))throw Error('Campus frame needs three hashed original views');
    cameras[direction]=value.cameras[direction];sha256[direction]=value.sha256[direction];
   }
   ids.add(value.id);last=value.atMs;
   return {id:value.id,atMs:value.atMs,sourceAtMs:value.sourceAtMs,episodeNumber:value.episodeNumber,cameras,sha256};
  });
  return new CampusSource(rows,createHash('sha256').update(raw).digest('hex'));
 }
}

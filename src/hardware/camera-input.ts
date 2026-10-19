import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

/** Existing serial firmware has no exposure timestamp; do not invent one. */
export async function cameraObservation(value:unknown,root:string):Promise<SpatialObservation>{
 const row=value as Record<string,unknown>;
 if(!row||typeof row.id!=='string'||!row.id||typeof row.recordingId!=='string'||!row.recordingId||
    !Number.isInteger(row.atMs)||Number(row.atMs)<0||row.sourceAtMs!==row.atMs||
    row.timestampSource!=='host-request'||row.exposureTimeKnown!==false||row.direction!=='front'||
    !Array.isArray(row.frames)||row.frames.length!==1||typeof row.frames[0]!=='string'||
    typeof row.sha256!=='string'||!Number.isInteger(row.sequence)||Number(row.sequence)<0||
    !Number.isInteger(row.receivedAtMs)||Number(row.receivedAtMs)<Number(row.atMs))throw Error('Invalid hardware capture receipt');
 const frame=resolve(row.frames[0]);const rel=relative(resolve(root,'frames'),frame);
 if(!rel||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('Frame outside capture archive');
 const bytes=await readFile(frame);
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256||bytes.length!==row.bytes||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Hardware original image integrity failure');
 return {id:row.id,recordingId:row.recordingId,atMs:Number(row.atMs),sourceAtMs:Number(row.sourceAtMs),frames:[frame]};
}

/** Streaming equivalent of spatialWindows; final flush only on explicit end. */
export class CameraWindows {
 private pending:SpatialObservation[]=[];
 private previous:SpatialObservation|undefined;
 private started=-Infinity;
 push(row:SpatialObservation){
  if(this.previous&&(row.atMs<this.previous.atMs||row.recordingId!==this.previous.recordingId))throw Error('Hardware session changed or time regressed; start a new run');
  if(this.previous&&row.atMs===this.previous.atMs)throw Error('Duplicate hardware timestamp');
  this.pending.push(row);this.previous=row;
  if(row.atMs-this.pending[0]!.atMs>=10000&&row.atMs-this.started>=5000){this.started=row.atMs;return [this.pending.splice(0,4)];}
  return [];
 }
 finish(){const result:SpatialObservation[][]=[];while(this.pending.length)result.push(this.pending.splice(0,4));return result;}
}

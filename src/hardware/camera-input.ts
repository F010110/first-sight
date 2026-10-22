import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

/** Existing serial firmware has no exposure timestamp; do not invent one. */
export async function cameraObservation(value:unknown,root:string):Promise<SpatialObservation>{
 const row=value as Record<string,unknown>;
  if(row?.transport==='wifi-http')return wifiObservation(row,root);
  if(row?.transport==='wifi-single-http'&&(row.wireSha256!==row.sha256||typeof row.deviceBootId!=='string'||!row.deviceBootId||row.deviceSequence!==row.sequence||!Number.isInteger(row.deviceCaptureMs)||Number(row.deviceCaptureMs)<0||row.deviceClockAligned!==false||row.width!==640||row.height!==480))throw Error('Invalid single Wi-Fi device receipt');
  if(row?.transport==='wifi-network-http'&&(row.wireSha256!==row.sha256||typeof row.deviceBootId!=='string'||!row.deviceBootId||!Number.isInteger(row.deviceSequence)||Number(row.deviceSequence)<0||typeof row.gapBefore!=='boolean'||!Number.isInteger(row.deviceCaptureMs)||Number(row.deviceCaptureMs)<0||row.deviceClockAligned!==false||row.width!==640||row.height!==480))throw Error('Invalid network camera receipt');
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

async function wifiObservation(row:Record<string,unknown>,root:string):Promise<SpatialObservation>{
 const cameras=row.cameras as Array<Record<string,unknown>>;
 if(typeof row.id!=='string'||!row.id||typeof row.recordingId!=='string'||!row.recordingId||
    !Number.isInteger(row.atMs)||Number(row.atMs)<0||row.sourceAtMs!==row.atMs||
    row.timestampSource!=='host-request'||row.exposureTimeKnown!==false||
    !Array.isArray(cameras)||cameras.length!==3||!Array.isArray(row.frames)||row.frames.length!==3||
    !Number.isFinite(row.dispatchSkewMs)||Number(row.dispatchSkewMs)<0||!Number.isFinite(row.maxDispatchSkewMs)||Number(row.maxDispatchSkewMs)>250||Number(row.dispatchSkewMs)>Number(row.maxDispatchSkewMs))throw Error('Invalid Wi-Fi rig receipt');
 const identities=new Set(),frames:string[]=[],times:number[]=[];
 for(let i=0;i<3;i++){
  const c=cameras[i]!;
  if(c.direction!==['front','left','right'][i]||typeof c.cameraId!=='string'||!c.cameraId||identities.has(c.cameraId)||
     c.deviceClockAligned!==false||typeof c.frame!=='string'||c.frame!==row.frames[i]||!Number.isInteger(c.requestAtMs)||!Number.isInteger(c.receivedAtMs)||Number(c.receivedAtMs)<Number(c.requestAtMs))throw Error('Invalid Wi-Fi camera identity/timing');
  identities.add(c.cameraId);const frame=resolve(c.frame),rel=relative(resolve(root,'frames'),frame);
  if(!rel||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('Frame outside capture archive');
  const bytes=await readFile(frame);
  if(createHash('sha256').update(bytes).digest('hex')!==c.sha256||bytes.length!==c.bytes||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Wi-Fi original image integrity failure');
  times.push(Number(c.requestAtMs));frames.push(frame);
 }
 if(new Set(frames).size!==3||Math.min(...times)!==row.atMs||Math.max(...times)-Math.min(...times)>Number(row.maxDispatchSkewMs)+1)throw Error('Invalid rig frame/dispatch alignment');
 return {id:row.id as string,recordingId:row.recordingId as string,atMs:Number(row.atMs),sourceAtMs:Number(row.atMs),frames};
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

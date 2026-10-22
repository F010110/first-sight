import {join} from 'node:path';
import {spatialJsonVlm,type SpatialJsonRequest} from '../agent/spatial-json-vlm.js';
/** Rolling one-hour spending windows. Stopping/restarting interaction does not reset usage. */
export function liveProvider(root:string,maxUSD:number,now=Date.now,create=spatialJsonVlm){
 const start=now();let window=-1;let request:ReturnType<typeof spatialJsonVlm>;
 return async(input:SpatialJsonRequest)=>{const next=Math.floor((now()-start)/3600000);if(next!==window){window=next;request=create(join(root,'hour-'+String(window).padStart(5,'0')),4096,maxUSD);}return request(input);};
}

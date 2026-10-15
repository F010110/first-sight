import { readFile } from "node:fs/promises";
import { resolve,join,basename } from "node:path";
import { SpatialTopologyService } from "../agent/spatial-topology-service.js";
import { topologyVlm } from "../agent/spatial-topology-vlm.js";

const [capture,root,recordingId]=process.argv.slice(2);
if(!capture || !root || !recordingId)throw new Error("Usage: capture-directory memory-directory unique-recording-id");
const service=new SpatialTopologyService(join(root,"topology.json"),topologyVlm(join(root,"requests")));
await service.load();
const initial=service.snapshot();
const existing=initial.observations.find(o=>o.recordingId===recordingId);
const offset=existing ? existing.atMs-(existing.sourceAtMs ?? 0) : (initial.observations.at(-1)?.atMs ?? -1)+1;
const rows=(await readFile(join(capture,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).map(s=>JSON.parse(s) as {endTick:number;frame:string});
// Resume the durable inbox before starting a different recording.
while(service.snapshot().pending.length)await service.tick(initial.observations.at(-1)!.atMs,true);
for(let i=0;i<rows.length;i++) {
	const row=rows[i]!,id=`${recordingId}:observation-${i+1}`,atMs=offset+row.endTick*1000;
	if(service.snapshot().observations.some(o=>o.id===id))continue;
	await service.ingest({id,atMs,sourceAtMs:row.endTick*1000,recordingId,frames:[resolve(capture,"triple",basename(row.frame))]});
	await service.tick(atMs);
}
while(service.snapshot().pending.length)await service.tick(service.snapshot().observations.at(-1)!.atMs,true);
console.log(JSON.stringify({observations:service.snapshot().observations.length,nodes:service.snapshot().nodes.length,edges:service.snapshot().edges.length,pending:service.snapshot().pending.length}));

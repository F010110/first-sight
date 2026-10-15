import { readFile,writeFile,mkdir,copyFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { resolve,join } from "node:path";
import { SpatialSqliteService } from "../agent/spatial-sqlite-service.js";
import { SpatialRetriever } from "../agent/spatial-retrieve.js";
import { SpatialEventStore } from "../agent/spatial-event-store.js";
import { RequestAgent } from "../agent/request-agent.js";
import { SceneChangeAgent } from "../agent/scene-change-agent.js";
import { compareSpatialHistory } from "../agent/spatial-agent-bridge.js";
import { topologyVlm } from "../agent/spatial-topology-vlm.js";

const [dataArg,rootArg,confirm,closedSeedDb]=process.argv.slice(2);
if(!dataArg||!rootArg||confirm!=="--confirm-paid")throw new Error("Usage: spatial-dev-smoke dataset NEW-result-directory --confirm-paid (bounded real model integration test)");
const data=resolve(dataArg),root=resolve(rootArg);await mkdir(root,{recursive:false});
if(closedSeedDb)await copyFile(resolve(closedSeedDb),join(root,"topology.sqlite")); // Explicit closed-database fixture only.
const service=new SpatialSqliteService(join(root,"topology.sqlite"),topologyVlm(join(root,"requests")));
await service.load();let retrieve:SpatialRetriever|null=null;const events=new SpatialEventStore(join(root,"changes.sqlite"));
try{
	const rows=(await readFile(join(data,"observations.jsonl"),"utf8")).trim().split(/\r?\n/).slice(0,4).map(line=>JSON.parse(line) as {id:string;sessionId:string;atMs:number;cameras:{front:string;left:string;right:string}});
	for(const row of rows.slice(0,3))if(!service.hasObservation(row.id))await service.ingest({id:row.id,recordingId:row.sessionId,atMs:row.atMs,frames:[row.cameras.front,row.cameras.left,row.cameras.right].map(path=>resolve(data,path))});
	await service.tick(30000,true);
	retrieve=new SpatialRetriever(join(root,"topology.sqlite"),events);
	const row=rows[2]!; // Revisit query excludes this observation by as-of, even though it is already assigned.
	const frames=[row.cameras.front,row.cameras.left,row.cameras.right].map((path,i)=>({id:`${row.id}:${i}`,timestampMs:row.atMs,path:resolve(data,path)}));
	const session=retrieve.session({asOfMs:row.atMs-0.001},8);
	const request=new RequestAgent(null,session,value=>appendFileSync(join(root,"request-trace.jsonl"),JSON.stringify(value)+"\n"));request.set("ask","Inspect historical visual evidence and determine whether the current place was seen earlier. Search without keywords if necessary. If unsupported abstain; cite only actually inspected observation IDs.");
	const answer=await request.observe(frames,null,null);
	await writeFile(join(root,"request-result.json"),JSON.stringify(answer,null,2),{flag:"wx"});
	// Current identity must be explicitly assigned before change comparison; do not use last-confirmed as current.
	if(!service.hasObservation(row.id))await service.ingest({id:row.id,recordingId:row.sessionId,atMs:row.atMs,frames:frames.map(f=>f.path)});await service.tick(40000,true);
	const identity=retrieve.session({asOfMs:row.atMs}).identity(row.id);
	const change=await compareSpatialHistory(new SceneChangeAgent(join(root,"change"),true),retrieve.session({asOfMs:row.atMs},4),frames,identity,events,{id:row.id,recordingId:row.sessionId});
	await writeFile(join(root,"change-result.json"),JSON.stringify(change,null,2),{flag:"wx"});
	console.log(JSON.stringify({status:service.summary(),requestEvidence:answer.historicalEvidenceIds,requestTrace:answer.historicalTrace,changeStatus:change.status}));
}catch(error){await writeFile(join(root,"failure.json"),JSON.stringify({message:error instanceof Error?error.message:String(error)},null,2),{flag:"wx"});throw error;}
finally{retrieve?.close();events.close();service.close();}

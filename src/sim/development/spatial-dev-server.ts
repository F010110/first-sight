import { createServer } from "node:http";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve,join,extname } from "node:path";
import { SpatialSqliteService } from "../../agent/spatial-sqlite-service.js";
import { SpatialRetriever } from "../../agent/spatial-retrieve.js";
import { SpatialEvidenceRetriever } from "../../agent/spatial-evidence-retrieve.js";
import { SpatialEventStore } from "../../agent/spatial-event-store.js";
import { RequestAgent } from "../../agent/request-agent.js";
import { SceneChangeAgent } from "../../agent/scene-change-agent.js";
import { compareSpatialHistory } from "../../agent/spatial-agent-bridge.js";
import { topologyVlm } from "../../agent/spatial-topology-vlm.js";
import type { SpatialObservation } from "../../agent/incremental-spatial-memory.js";
import type { FrameRef } from "../../agent/types.js";

// Local trusted simulator datasets only. Never mounted on the product trial server.
const [datasetArg,workspaceArg,portArg="3417"]=process.argv.slice(2);
if(!datasetArg||!workspaceArg)throw new Error("Usage: spatial-dev-server dataset-directory NEW-workspace [port]");
const dataset=resolve(datasetArg),workspace=resolve(workspaceArg),port=Number(portArg);
const datasetReport=JSON.parse(await readFile(join(dataset,"dataset-report.json"),"utf8")) as {buildings:number};
if(datasetReport.buildings!==1)throw new Error("Use one building per developer workspace; unrelated worlds must not share identities");
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid port");
await mkdir(workspace,{recursive:true});
const binding=join(workspace,"dataset-binding.json");
try{await writeFile(binding,JSON.stringify({dataset}),{flag:"wx"});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;if(JSON.parse(await readFile(binding,"utf8")).dataset!==dataset)throw new Error("Workspace belongs to another dataset");}
const rows=(await readFile(join(dataset,"observations.jsonl"),"utf8")).trim().split(/\r?\n/).filter(Boolean).map(line=>{
	const row=JSON.parse(line) as {id:string;sessionId:string;atMs:number;sourceAtMs?:number;cameras:{front:string;left:string;right:string}};
	if(!row.id||!row.sessionId||!Number.isFinite(row.atMs)||!row.cameras)throw new Error("Invalid simulator observation");
	const frames=[row.cameras.front,row.cameras.left,row.cameras.right].map(path=>{const full=resolve(dataset,path);if(!full.startsWith(dataset+"\\")&&!full.startsWith(dataset+"/"))throw new Error("Dataset path escapes package");return full;});
	return {id:row.id,recordingId:row.sessionId,atMs:row.atMs,sourceAtMs:row.sourceAtMs ?? row.atMs,frames} satisfies SpatialObservation;
});
if(new Set(rows.map(row=>row.id)).size!==rows.length||rows.some((row,i)=>i>0&&row.atMs<rows[i-1]!.atMs))throw new Error("Dataset requires unique IDs and ordered clock");
const service=new SpatialSqliteService(join(workspace,"topology.sqlite"),topologyVlm(join(workspace,"requests")));
await service.load();
const events=new SpatialEventStore(join(workspace,"changes.sqlite"));
const retriever=new SpatialRetriever(join(workspace,"topology.sqlite"),events);
// Trusted operator opt-in only; never accept an archive path from browser/model input.
if(process.env.SPATIAL_AUXILIARY_TEXT_INDEX&&!process.env.SPATIAL_EVIDENCE_ARCHIVE)throw Error('Auxiliary text index requires evidence archive');
const archive=process.env.SPATIAL_EVIDENCE_ARCHIVE?new SpatialEvidenceRetriever(process.env.SPATIAL_EVIDENCE_ARCHIVE,process.env.SPATIAL_AUXILIARY_TEXT_INDEX):null;
const token=randomBytes(32).toString("hex");let busy=false;
const frameRefs=(row:SpatialObservation):FrameRef[]=>row.frames.map((path,i)=>({id:`${row.id}:${i}`,path,timestampMs:row.atMs}));
const server=createServer(async(req,res)=>{
	try{
		const url=new URL(req.url ?? "/",`http://127.0.0.1:${port}`);
		if(req.headers.host!==`127.0.0.1:${port}`)throw new Error("Use the printed loopback URL");
		res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
		if(req.method==="GET"&&url.pathname==="/"){
			res.setHeader("Content-Type","text/html; charset=utf-8");res.end((await readFile(resolve("sim/benchmarks/spatial-dev.html"),"utf8")).replace("__TOKEN__",token));return;
		}
		if(req.method==="GET"&&url.pathname==="/image"){
			const row=rows.find(r=>r.id===url.searchParams.get("id")),index=Number(url.searchParams.get("camera"));
			if(!row||!Number.isInteger(index)||index<0||index>2)throw new Error("Unknown image ID");
			res.setHeader("Content-Type",extname(row.frames[index]!).toLowerCase()===".png"?"image/png":"image/jpeg");res.end(await readFile(row.frames[index]!));return;
		}
		if(req.method!=="POST"||url.pathname!=="/command"||req.headers["x-dev-token"]!==token||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)throw new Error("Denied");
		let body="";for await(const chunk of req){body+=String(chunk);if(body.length>16384)throw new Error("Command too large");}
		const input=JSON.parse(body) as Record<string,unknown>;
		if(busy)throw new Error("Another developer operation is active");busy=true;
		try{
			let result:unknown;
			const selected=rows.find(row=>row.id===input.id);
			const requireSelected=()=>{if(!selected)throw new Error("Select an observation");return selected;};
			const requirePaid=()=>{if(input.confirmPaid!==true)throw new Error("Explicit paid-call checkbox required");if(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL)throw new Error("Provider not configured");};
			switch(input.action){
				case "status":result={status:service.summary(),observations:rows.map(row=>({id:row.id,sessionId:row.recordingId,atMs:row.atMs,ingested:service.hasObservation(row.id)})),graph:service.page(100,typeof input.cursor==="number"?input.cursor:0),nodes:service.context().nodes};break;
				case "step":{
					const next=rows.find(row=>!service.hasObservation(row.id));if(next)await service.ingest(next);result=service.summary();break;
				}
				case "recognize":requirePaid();await service.tick(service.lastObservationTime()+10000,true);result=service.summary();break;
				case "retrieve":{
					const row=requireSelected(),session=archive?archive.session({asOfMs:row.atMs,recordingId:row.recordingId}):retriever.session({asOfMs:row.atMs-0.001});
					result=session.search({...(typeof input.placeId==="string"&&input.placeId?{placeId:input.placeId}:{}),...(typeof input.keyword==="string"?{query:input.keyword}:{}),...(typeof input.cursor==="number"?{cursor:input.cursor}:{}),limit:6});break;
				}
				case "request":{
					requirePaid();const row=requireSelected(),session=archive?archive.session({asOfMs:row.atMs,recordingId:row.recordingId},8):retriever.session({asOfMs:row.atMs-0.001},8);
					const task=input.task==="revisit"?"Use historical visual evidence to determine if this place was visited earlier. Abstain if unsupported.":"Retrieve earlier observations of this place and describe only visually supported differences. Abstain if no evidence.";
					const agent=new RequestAgent(null,session);agent.set("ask",task);result=await agent.observe(frameRefs(row),null,null);break;
				}
				case "change":{
					requirePaid();const row=requireSelected();const placeId=retriever.session({asOfMs:row.atMs}).identity(row.id);
					if(input.placeId&&input.placeId!==placeId)throw new Error("Selected place does not match current observation assignment");
					result=await compareSpatialHistory(new SceneChangeAgent(join(workspace,"change"),true),retriever.session({asOfMs:row.atMs},4),frameRefs(row),placeId,events,{id:row.id,...row.recordingId!==undefined?{recordingId:row.recordingId}:{}});break;
				}
				case "revise":{
					if(!["confirm","split","merge"].includes(String(input.kind))||typeof input.placeId!=="string"||!selected)throw new Error("Invalid revision");
					result=await service.revise(input.kind as "confirm"|"split"|"merge",input.placeId,"developer review",[selected.id],{...(typeof input.targetId==="string"?{targetId:input.targetId}:{}),...(typeof input.summary==="string"?{summary:input.summary}:{})});break;
				}
				case "place":if(typeof input.placeId!=="string")throw new Error("Select place");result=service.place(input.placeId);break;
				case "undo":if(typeof input.revisionId!=="string")throw new Error("Select revision");await service.undo(input.revisionId,"developer withdrawal");result={undone:true};break;
				default:throw new Error("Unknown command");
			}
			if(input.action!=="status")await writeFile(join(workspace,`event-${Date.now()}-${randomBytes(4).toString("hex")}.json`),JSON.stringify({input,result},null,2),{flag:"wx"});
			res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
		}finally{busy=false;}
	}catch(error){res.statusCode=400;res.setHeader("Content-Type","application/json");res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}
});
server.listen(port,"127.0.0.1",()=>console.log(`Simulator developer memory: http://127.0.0.1:${port} (no model calls until explicitly requested)`));
const close=()=>server.close(()=>{archive?.close();retriever.close();events.close();service.close();process.exit(0);});process.on("SIGINT",close);process.on("SIGTERM",close);

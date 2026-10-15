import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";
import { SpatialRetriever } from "./spatial-retrieve.js";
import { RequestAgent } from "./request-agent.js";

test("RequestAgent actually searches and inspects scoped SQLite evidence via streamed tool loop",{timeout:15000},async()=>{
	const root=await mkdtemp(join(tmpdir(),"request-integration-"));
	const previous={key:process.env.QWEN_API_KEY,url:process.env.QWEN_BASE_URL};let calls=0;
	const server=createServer(async(req,res)=>{
		let text="";for await(const chunk of req)text+=String(chunk);
		const body=JSON.parse(text);assert.equal(body.enable_thinking,false);assert.equal(body.model,"qwen3.8-flash");calls++;
		res.setHeader("Content-Type","text/event-stream");
		const emit=(delta:unknown,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({id:`r${calls}`,object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta,finish_reason}],...(finish_reason?{usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}:{})})}\n\n`);
		if(calls<=2){emit({role:"assistant",tool_calls:[{index:0,id:`tool${calls}`,type:"function",function:{name:"retrieve_visual_history",arguments:JSON.stringify(calls===1?{}:{ids:["o0"]})}}]});emit({},"tool_calls");}
		else{emit({role:"assistant",content:JSON.stringify({kind:"question",answer:"Seen in the historical observation.",shouldSpeak:false,done:true,confidence:0.8,historicalEvidenceIds:["o0"],abstained:false})});emit({},"stop");}
		res.end("data: [DONE]\n\n");
	});
	await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
	let db:SpatialSqliteStore|null=null,retrieve:SpatialRetriever|null=null;
	try{
		const address=server.address();assert.ok(address&&typeof address!=="string");process.env.QWEN_API_KEY="test-only";process.env.QWEN_BASE_URL=`http://127.0.0.1:${address.port}/v1`;
		const image=join(root,"frame.png");await writeFile(image,"fixture");const path=join(root,"m.sqlite");db=new SpatialSqliteStore(path);
		db.ingest({id:"o0",atMs:0,recordingId:"r",frames:[image]});db.commit([{observationId:"o0",placeId:"p",reason:"red sofa"}],[{id:"p",summary:"room",representatives:[],lastSeenMs:0}]);
		retrieve=new SpatialRetriever(path);const agent=new RequestAgent(null,retrieve.session({asOfMs:1},2));agent.set("ask","Was this seen before?");
		const result=await agent.observe([{id:"current",path:image,timestampMs:2}],null,null);
		assert.deepEqual(result.historicalEvidenceIds,["o0"]);assert.equal(calls,3);assert.equal(result.historicalTrace!.modelCalls,3);
	}finally{
		retrieve?.close();db?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
		if(previous.key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=previous.key;
		if(previous.url===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=previous.url;
		await rm(root,{recursive:true,force:true});
	}
});

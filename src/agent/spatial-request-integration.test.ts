import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp,writeFile,rm,mkdir } from "node:fs/promises";
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { SpatialEvidenceRetriever } from './spatial-evidence-retrieve.js';
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";
import { SpatialRetriever } from "./spatial-retrieve.js";
import { RequestAgent,HistoricalAnswerValidationError } from "./request-agent.js";

for(const backend of ['topology','archive'] as const)for(const constrainedFinal of [false,true])test(`RequestAgent searches and inspects ${backend}, constrained final=${constrainedFinal}`,{timeout:15000},async()=>{
	const root=await mkdtemp(join(tmpdir(),"request-integration-"));
	const previous={key:process.env.QWEN_API_KEY,url:process.env.QWEN_BASE_URL};let calls=0;
	const requests:Array<Record<string,any>>=[];
	const server=createServer(async(req,res)=>{
		let text="";for await(const chunk of req)text+=String(chunk);
		const body=JSON.parse(text);assert.equal(body.enable_thinking,false);assert.equal(body.model,"qwen3.8-flash");calls++;
		requests.push(body);
		res.setHeader("Content-Type","text/event-stream");
		const emit=(delta:unknown,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({id:`r${calls}`,object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta,finish_reason}],...(finish_reason?{usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}:{})})}\n\n`);
		if(calls<=2){emit({role:"assistant",tool_calls:[{index:0,id:`tool${calls}`,type:"function",function:{name:"retrieve_visual_history",arguments:JSON.stringify(calls===1?{}:{ids:["o0"]})}}]});emit({},"tool_calls");}
		else{emit({role:"assistant",content:JSON.stringify({kind:"question",answer:"Seen in the historical observation.",shouldSpeak:false,done:true,confidence:0.8,historicalEvidenceIds:["o0"],abstained:false})});emit({},"stop");}
		res.end("data: [DONE]\n\n");
	});
	await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
	let db:SpatialSqliteStore|null=null,retrieve:SpatialRetriever|SpatialEvidenceRetriever|null=null;
	try{
		const address=server.address();assert.ok(address&&typeof address!=="string");process.env.QWEN_API_KEY="test-only";process.env.QWEN_BASE_URL=`http://127.0.0.1:${address.port}/v1`;
		const image=join(root,"frame.png");await writeFile(image,"fixture");const path=join(root,"m.sqlite");db=new SpatialSqliteStore(path);
		db.ingest({id:"o0",atMs:0,recordingId:"r",frames:[image]});db.commit([{observationId:"o0",placeId:"p",reason:"red sofa"}],[{id:"p",summary:"room",representatives:[],lastSeenMs:0}]);
		if(backend==='archive'){
			const archive=join(root,'archive');await mkdir(join(archive,'images'),{recursive:true});await writeFile(join(archive,'images','frame.png'),'fixture');await writeFile(join(archive,'complete.json'),'{}');
			const raw=new DatabaseSync(join(archive,'evidence.sqlite'));raw.exec('CREATE TABLE observations(seq INTEGER PRIMARY KEY,id TEXT,session TEXT,at_ms REAL,raw TEXT)');
			const e={id:'o0',sessionId:'r',atMs:0,cameras:Object.fromEntries(['front','left','right'].map(v=>[v,'images/frame.png'])),sha256:Object.fromEntries(['front','left','right'].map(v=>[v,createHash('sha256').update('fixture').digest('hex')]))};raw.prepare('INSERT INTO observations VALUES(?,?,?,?,?)').run(1,'o0','r',0,JSON.stringify(e));raw.close();retrieve=new SpatialEvidenceRetriever(archive);
		}else retrieve=new SpatialRetriever(path);
		const agent=new RequestAgent(null,retrieve.session({asOfMs:1,recordingId:'r'},3),null,constrainedFinal?{jsonOutput:true,requiredEvidenceIds:['o0'],currentEvidenceLabels:['NEXT IMAGE CURRENT current'],providedEvidenceLabels:['NEXT IMAGE HISTORICAL fixture-history'],providedEvidence:[{type:'image',data:Buffer.from('historical-fixture').toString('base64'),mimeType:'image/png'}]}:undefined);agent.set("ask","Was this seen before?");
		const result=await agent.observe([{id:"current",path:image,timestampMs:2}],null,null);
		assert.deepEqual(result.historicalEvidenceIds,["o0"]);assert.equal(calls,3);assert.equal(result.historicalTrace!.modelCalls,3);
		if(constrainedFinal){assert.equal(requests[0]!.response_format,undefined);assert.equal(requests[1]!.response_format,undefined);assert.equal(requests[0]!.tool_choice,'required');assert.equal(requests[1]!.tool_choice,'required');assert.deepEqual(requests[2]!.response_format,{type:'json_object'});assert.ok(!requests[2]!.tools?.length);}
		if(constrainedFinal){const blocks=requests[0]!.messages.find((m:any)=>m.role==='user').content;const currentIndex=blocks.findIndex((b:any)=>b.text==='NEXT IMAGE CURRENT current');const historyIndex=blocks.findIndex((b:any)=>b.text==='NEXT IMAGE HISTORICAL fixture-history');assert.ok(currentIndex>=0&&historyIndex>currentIndex);assert.equal(blocks[currentIndex+1].image_url.url,'data:image/png;base64,'+Buffer.from('fixture').toString('base64'));assert.equal(blocks[historyIndex+1].image_url.url,'data:image/png;base64,'+Buffer.from('historical-fixture').toString('base64'));}
		const rejected=new RequestAgent(null,retrieve.session({asOfMs:1,recordingId:'r'},3));rejected.set('ask','Answer without evidence');
		await assert.rejects(rejected.observe([{id:'current',path:image,timestampMs:2}],null,null),(error:unknown)=>error instanceof HistoricalAnswerValidationError&&error.rawAnswer.includes('historicalEvidenceIds'));
	}finally{
		retrieve?.close();db?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
		if(previous.key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=previous.key;
		if(previous.url===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=previous.url;
		await rm(root,{recursive:true,force:true});
	}
});

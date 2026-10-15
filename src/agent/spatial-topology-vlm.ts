import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WindowAnswer, WindowRecognizer } from "./spatial-topology-service.js";

export function topologyVlm(logRoot: string): WindowRecognizer {
	return async (batch,history) => {
		const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;
		if (!key || !base) throw new Error("Missing Qwen configuration");
		const directory=join(logRoot,randomUUID()); await mkdir(directory,{recursive:true});
		const content: Array<Record<string,unknown>>=[{type:"text",text:`逐图判断观察者所在具体空间，不是隔门可见空间。短窗口可包含多个地点，不强制一个主体。开放空间可用实例布局区分局部地点，不凭功能名称或旋转新建。历史ID必须准确引用；新候选用new-1、new-2等本次临时ID；证据不足placeId为null。只输出JSON {"places":[{"id":"历史ID或new-1","summary":"布局摘要"}],"assignments":[{"observationId":"输入ID","placeId":"声明的ID或null","reason":"可见证据"}]}。每个当前观察一次。历史参照非当前状态，不编造墙或门。目录：${JSON.stringify(history.nodes.map(n=>({id:n.id,summary:n.summary})))}`}];
		const sent=new Set<string>();
		const add=async (label:string,id:string,atMs:number,frames:string[]) => {
			content.push({type:"text",text:`${label} ${id} atMs=${atMs}`});
			for (const path of frames) {
				if(sent.has(path))continue; sent.add(path);
				const mime=/\.png$/i.test(path)?"image/png":/\.webp$/i.test(path)?"image/webp":"image/jpeg";
				content.push({type:"image_url",image_url:{url:`data:${mime};base64,${(await readFile(path)).toString("base64")}`}});
			}
		};
		for(const node of [...history.nodes].sort((a,b)=>b.lastSeenMs-a.lastSeenMs).slice(0,3)) {
			const representative=node.representatives.at(-1); if(representative)await add(`HISTORICAL_REFERENCE placeId=${node.id}`,representative.id,representative.atMs,representative.frames);
		}
		for(const observation of batch)await add("CURRENT_TARGET",observation.id,observation.atMs,observation.frames);
		await writeFile(join(directory,"input.json"),JSON.stringify({batch,history,model:"qwen3.8-flash",enable_thinking:false},null,2));
		const started=Date.now();
		try {
			const messages: Array<Record<string,unknown>>=[{role:"user",content}];
			for(let attempt=0;attempt<2;attempt++) {
			const response=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"qwen3.8-flash",messages,temperature:0,max_tokens:1800,enable_thinking:false}),signal:AbortSignal.timeout(120000)});
			if(!response.ok)throw new Error(`VLM HTTP ${response.status}`);
			const raw=await response.json() as {choices:Array<{message:{content:string}}>};
			await writeFile(join(directory,`response-${attempt}.json`),JSON.stringify({response:raw,elapsedMs:Date.now()-started},null,2));
			const text=raw.choices[0]!.message.content;
			try {
				const answer=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"")) as WindowAnswer;
				if(!answer || !Array.isArray(answer.places) || !Array.isArray(answer.assignments))throw new Error("Return object with places and assignments, not object detections or an array");
				const ids=answer.places.map(p=>p.id);
				if(new Set(ids).size!==ids.length || answer.places.some(p=>typeof p.id!=="string" || !p.summary?.trim() || (!history.nodes.some(n=>n.id===p.id) && !/^new-[1-9][0-9]*$/.test(p.id))))throw new Error("Places need unique supplied historical IDs or new-N and summaries");
				if(answer.assignments.length!==batch.length || new Set(answer.assignments.map(a=>a.observationId)).size!==batch.length || answer.assignments.some(a=>!batch.some(o=>o.id===a.observationId) || !a.reason?.trim() || (a.placeId!==null && !ids.includes(a.placeId) && !history.nodes.some(n=>n.id===a.placeId))))throw new Error("Assign every current observation exactly once with reason; placeId must be a supplied historical ID, declared new ID, or null");
				return answer;
			} catch(error) {
				if(attempt===1)throw error;
				messages.push({role:"assistant",content:text},{role:"user",content:`协议错误：${(error as Error).message}。这是地点身份任务，不是检测框任务。按原证据返回完整places/assignments JSON，不增加证据。`});
			}
			}
			throw new Error("No valid topology answer");
		} catch(error) {
			await writeFile(join(directory,"failure.json"),JSON.stringify({type:(error as Error).name,elapsedMs:Date.now()-started})); throw error;
		}
	};
}

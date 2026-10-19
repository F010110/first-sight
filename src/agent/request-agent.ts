import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import type { FrameRef } from "./types.js";
import type { HistoricalEvidenceSession } from "./spatial-evidence-retrieve.js";
import {memorySummary,type MemorySummary} from './memory-summary.js';
import {lockedProtocolPatch} from './locked-protocol.js';

/**
 * RequestAgent (role 3 of 3): handles the user's *explicit* requirement.
 *
 * It only runs when the user actually asked for something (a question, a goal,
 * or a condition to watch). It receives the current frames plus the same
 * auxiliary context as the other agents (motion-mode in natural language, and
 * the current scene label) and answers / decides whether to speak.
 *
 * This is deliberately a plain VLM agent with a small amount of state: the model
 * is not fine-tuned, so the reply is natural language and only the control flags
 * (kind/shouldSpeak/done/confidence) are structured.
 */

export type RequestMode = "ask" | "watch";
export type RequestKind = "question" | "goal" | "watch";

/** Rejected model output is distinct from provider/tool infrastructure failure. */
export class HistoricalAnswerValidationError extends Error {
	constructor(message:string,readonly rawAnswer:string){super(message);this.name='HistoricalAnswerValidationError';}
}

export interface RequestTurn {
	atMs: number;
	kind: RequestKind;
	answer: string;
	shouldSpeak: boolean;
	done: boolean;
	confidence: number;
}

export interface RequestState {
	mode: RequestMode | null;
	kind: RequestKind | null;
	text: string | null;
	status: "idle" | "active" | "done";
	/** True once a watch condition has been reported, so it is never repeated. */
	spoken: boolean;
	lastAnswer: string | null;
	turns: RequestTurn[];
	startedAtMs: number | null;
	updatedAtMs: number | null;
}

export interface RequestResult {
	historicalEvidenceIds?: string[];
	historicalTrace?: { inspectedIds:string[]; modelCalls:number; tokens:number; elapsedMs:number };
	kind: RequestKind;
	answer: string;
	shouldSpeak: boolean;
	done: boolean;
	confidence: number;
	frameIds: string[];
	raw: string;
}

export interface SceneMemoryScene {
	id: string;
	label: string;
	summary: string;
	objects: string[];
	visits: number;
	lastSeenMs: number;
}

export interface SceneMemoryChange {
	sceneId: string;
	what: string;
	atMs: number;
}

export interface SceneMemorySnapshot {
	currentSceneId: string | null;
	scenes: SceneMemoryScene[];
	visitedOrder: string[];
	/** Edges between places with their usual path (qualitative). */
	transitions: Array<{ from: string; to: string; count: number; path: string }>;
	changes: SceneMemoryChange[];
}

export type SceneMemoryProvider = () => SceneMemorySnapshot;

const SYSTEM_PROMPT = [
	"You are the user-request agent of a first-person visual assistant.",
	"The user has given ONE explicit requirement. Read the current camera frames and respond helpfully, in the user's own language.",
	"Classify the requirement as one of: QUESTION (something to answer), GOAL (something to achieve or find), WATCH (a condition to report when it actually happens).",
	"SPATIAL FRAME: the image is a narrow view from the phone's rear camera, roughly what the user is facing �?it is NOT the user's whole surroundings and there is no depth map. The image centre is roughly straight ahead of the user; the left of the image is the user's front-left; the right of the image is their front-right; up/down are slightly above/below.",
	"When asked where something is, give its position relative to the USER or to another object the user can name (e.g. 'directly in front of you, left side of the desk, next to the laptop'). NEVER answer in terms of image or pixel coordinates such as 'the right side of the picture'.",
	"If the thing is not visible in the current view, say so plainly and suggest where to look or that it may be outside the current view (behind / beside / below); do not invent a position.",
	"A 'MOTION' line (how the phone moved, natural language) and a 'SCENE' line (current place) are approximate context; use them to help interpret the frames.",
	"For a WATCH condition be conservative: shouldSpeak must be true only when the current frames clearly show the condition is happening now. Never set shouldSpeak for a condition that was already reported.",
	"For a QUESTION answer once and set done=true. For a GOAL give brief, actionable help; set done=true only when it is clearly achieved or impossible.",
	"You have a tool `search_scene_memory` to look up places the user has already visited and recent changes in them. Use it ONLY when the request is about the place they are in, whether they have been somewhere before, or what changed there; never use it for ordinary object questions.",
	"Keep 'answer' to one or two short sentences. If there is nothing useful to say, make 'answer' the reason and shouldSpeak=false.",
	'Reply with ONLY JSON: {"kind": "question|goal|watch", "answer": string, "shouldSpeak": boolean, "done": boolean, "confidence": number}. No markdown.',
].join(" ");

function mimeTypeFor(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg": case ".jpeg": return "image/jpeg";
		case ".png": return "image/png";
		case ".webp": return "image/webp";
		default: return "image/jpeg";
	}
}

function parseRequest(text: string, fallbackKind: RequestKind | null): Omit<RequestResult, "frameIds" | "raw"> {
	const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const root = JSON.parse(jsonText) as Record<string, unknown>;
	const rawKind = typeof root.kind === "string" ? root.kind.toLowerCase() : "";
	const kind: RequestKind = rawKind === "question" || rawKind === "goal" || rawKind === "watch" ? rawKind : fallbackKind ?? "question";
	if (typeof root.answer !== "string" || !root.answer.trim()) throw new Error("request.answer must be a non-empty string");
	const confidence = typeof root.confidence === "number" && root.confidence >= 0 && root.confidence <= 1 ? root.confidence : 0.5;
	return {
		kind,
		answer: root.answer.trim().slice(0, 400),
		shouldSpeak: typeof root.shouldSpeak === "boolean" ? root.shouldSpeak : kind === "question",
		done: typeof root.done === "boolean" ? root.done : kind === "question",
		confidence,
	};
}

export class RequestAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private modelToolsClosed=false;
	private state: RequestState = {
		mode: null, kind: null, text: null, status: "idle", spoken: false, lastAnswer: null, turns: [], startedAtMs: null, updatedAtMs: null,
	};

 constructor(private readonly getSceneMemory: SceneMemoryProvider | null = null, private readonly retrieval: HistoricalEvidenceSession | null = null, private readonly onTrace: ((value:Record<string,unknown>)=>void) | null = null, private readonly runtime?:{beforeModelCall?:()=>void;contextText?:string;providedEvidence?:ImageContent[];providedEvidenceLabels?:string[];currentEvidenceLabels?:string[];jsonOutput?:boolean;requiredEvidenceIds?:string[];memorySummary?:(()=>MemorySummary)|false;allowContextRetrieval?:boolean}) {
 		const configured = createQwenModel(512, retrieval!==null,runtime?.jsonOutput??false,()=>!this.modelToolsClosed&&(runtime?.requiredEvidenceIds?.some(id=>!retrieval?.inspected.has(id))??false),()=>this.modelToolsClosed,runtime?.memorySummary===false?false:()=>{
			const snapshot=this.getSceneMemory?.();const summary=typeof runtime?.memorySummary==='function'?runtime.memorySummary():retrieval?.memorySummary?.()??memorySummary(snapshot?.scenes.map(s=>({id:s.id,atMs:s.lastSeenMs,text:s.summary,sourceIds:[s.id],kind:'working-memory' as const}))??[],Date.now());this.onTrace?.({operation:'memory-summary',summary});return summary;
		});
		this.model = configured.model;
		this.streamFn = (...args)=>{this.runtime?.beforeModelCall?.();return configured.streamFn(...args);};
	}

	private historicalTool(): AgentTool<any> {
		return {
			name:"retrieve_visual_history",label:"历史视觉证据",
			description:"Two operations: SEARCH with query (or {} for chronological paging); INSPECT with ids:[exact IDs returned by SEARCH] to open original images. You already have permission to inspect: do not ask the user. Search is literal text, not semantic: use ONE short keyword in the user's language (e.g. 体育�?or 小径), never append translations/synonyms or the entire question. If empty, simplify to one word or use {}. Cursor is opaque: use ONLY a returned nextCursor for the SAME query; reset/omit it on any query change. After candidates, inspect 1 observation (3 images) before answering; do not spend all turns searching. No match means unknown, not absent. Only inspected images support historical claims.",
			parameters:{type:"object",properties:{query:{type:"string",description:"Single short literal keyword; omit for chronological history."},atTime:{type:'string',description:'Exact calendar timestamp, including date and time; ISO8601 with timezone preferred.'},afterTime:{type:'string',description:'Inclusive lower calendar timestamp.'},beforeTime:{type:'string',description:'Inclusive upper calendar timestamp.'},placeId:{type:'string',description:'Filter by an exact placeId returned by a prior search, to retrieve observations associated with the same remembered place.'},beforeMs:{type:'number',description:'Optional activity-clock upper bound.'},afterMs:{type:'number',description:'Optional activity-clock lower bound.'},ids:{type:"array",items:{type:"string"},description:"INSPECT operation: exact retrieved observation IDs, usually one ID per call."},cursor:{type:"integer",description:"Only returned nextCursor from same query; never invent."}},required:[]},
			execute:async(_id:string,params:unknown)=>{
				const p=params as {query?:string;ids?:string[];cursor?:number;placeId?:string;beforeMs?:number;afterMs?:number;atTime?:string;afterTime?:string;beforeTime?:string};
				if(p.ids){const images=await this.retrieval!.inspect(p.ids);return {content:images.flatMap(image=>{const source=image as typeof image&{sourceReference?:string;sourceAtMs?:number;episodeNumber?:number};return [{type:"text" as const,text:JSON.stringify({historicalEvidenceId:image.id,atMs:image.atMs,placeId:image.placeId,sourceReference:source.sourceReference,sourceAtMs:source.sourceAtMs,episodeNumber:source.episodeNumber,notCurrentTruth:true})},{type:"image" as const,data:image.data,mimeType:image.mimeType}];}),details:{ids:p.ids}};}
				const result=this.retrieval!.search({...p.query!==undefined?{query:p.query}:{},...p.cursor!==undefined?{cursor:p.cursor}:{},...p.placeId!==undefined?{placeId:p.placeId}:{},...p.beforeMs!==undefined?{beforeMs:p.beforeMs}:{},...p.afterMs!==undefined?{afterMs:p.afterMs}:{},...p.atTime!==undefined?{atTime:p.atTime}:{},...p.afterTime!==undefined?{afterTime:p.afterTime}:{},...p.beforeTime!==undefined?{beforeTime:p.beforeTime}:{},limit:4});return {content:[{type:"text" as const,text:JSON.stringify(result)}],details:{status:result.status}};
			},
		};
	}

	/** Optional tool: look up visited places and recent changes. The agent decides when to call it. */
	private sceneMemoryTool(): AgentTool<any> {
		return {
			name: "search_scene_memory",
			label: "搜索场景记忆",
			description: "Look up places the user has already visited and recent changes in them. Call this only when the request is about the place, prior visits, or what changed.",
			parameters: {
				type: "object",
				properties: { query: { type: "string", description: "Optional keywords to filter places (a place name or an object)." } },
				required: [],
			},
			execute: async (_toolCallId: string, params: unknown) => {
				const snapshot = this.getSceneMemory?.() ?? { currentSceneId: null, scenes: [], visitedOrder: [], transitions: [], changes: [] };
				const rawQuery = (params as { query?: unknown } | null)?.query;
				const query = typeof rawQuery === "string" ? rawQuery.trim().toLowerCase() : "";
				let scenes = snapshot.scenes;
				if (query) {
					const terms = query.split(/\s+/).filter(Boolean);
					const matched = scenes.filter((scene) => terms.some((term) => `${scene.label} ${scene.summary} ${scene.objects.join(" ")}`.toLowerCase().includes(term)));
					if (matched.length) scenes = matched;
				}
				const kept = new Set(scenes.slice(-10).map((scene) => scene.id));
				const result = {
					currentSceneId: snapshot.currentSceneId,
					visitedOrder: snapshot.visitedOrder,
					scenes: scenes.slice(-10).map((scene) => ({ id: scene.id, label: scene.label, summary: scene.summary, objects: scene.objects, visits: scene.visits })),
					connections: snapshot.transitions.filter((edge) => kept.has(edge.from) || kept.has(edge.to)).slice(-20),
					recentChanges: snapshot.changes.slice(-5),
				};
				return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { sceneCount: result.scenes.length } };
			},
		};
	}

	getState(): RequestState {
		return { ...this.state, turns: this.state.turns.slice(-10) };
	}

	set(mode: RequestMode, text: string): RequestState {
		this.state = {
			mode,
			kind: mode === "watch" ? "watch" : null,
			text,
			status: "active",
			spoken: false,
			lastAnswer: null,
			turns: [],
			startedAtMs: Date.now(),
			updatedAtMs: Date.now(),
		};
		return this.getState();
	}

	stop(): RequestState {
		this.state = { ...this.state, mode: null, kind: null, text: null, status: "idle", spoken: false, lastAnswer: null, turns: [] };
		this.state.updatedAtMs = Date.now();
		return this.getState();
	}

	async observe(frames: FrameRef[], motionDescription: string | null, sceneLabel: string | null): Promise<RequestResult> {
		const started=Date.now();
		if (this.state.status !== "active" || !this.state.text) throw new Error("No active user requirement");
		if (frames.length === 0) throw new Error("RequestAgent needs at least one frame");
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-3);
		const imageContents: ImageContent[] = await Promise.all(ordered.map(async (frame) => ({
			type: "image" as const, data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path),
		})));

		const recent = this.state.turns.slice(-3).map((turn) => ({ kind: turn.kind, answer: turn.answer, spoke: turn.shouldSpeak }));
		const promptLines = [
			this.runtime?.currentEvidenceLabels?"Answer the user's requirement using its specified source evidence. Each NEXT IMAGE label identifies ONLY the immediately following image. CURRENT images do not establish HISTORICAL facts. Match the requested sourceReference, not the first image or a similar scene.":"Answer the user's requirement using the current frames. Image blocks are in chronological order.",
			`MODE: ${this.state.mode ?? "ask"}`,
			`REQUIREMENT: ${this.state.text}`,
			`SCENE: ${sceneLabel ?? "unknown"}`,
			`MOTION (approximate, how the phone moved recently): ${motionDescription ?? "none"}`,
			`ALREADY_REPORTED (do not repeat these): ${JSON.stringify(recent)}${this.state.spoken ? " (a watch condition has already been reported; do not report it again)" : ""}`,
		];
		promptLines.push("Reply with only the JSON object.");
		if(this.runtime?.contextText)promptLines.push(this.runtime.contextText);
		const historicalSchema='MANDATORY historical JSON schema, include EVERY key: {"kind":"question|goal|watch","answer":string,"shouldSpeak":boolean,"done":boolean,"confidence":number,"historicalEvidenceIds":string[],"abstained":boolean}. abstained=false only with inspected supporting historical evidence; otherwise true. Do not omit abstained even when answering confidently. For first/earliest-history questions use chronological search {} and inspect earliest evidence; keyword search cannot establish what was seen first.';
		if(this.retrieval)promptLines.push(historicalSchema);
		const prompt = promptLines.join("\n\n");

		const evidenceReady=()=>!!this.runtime?.requiredEvidenceIds?.length&&this.runtime.requiredEvidenceIds.every(id=>this.retrieval?.inspected.has(id));
		this.modelToolsClosed=evidenceReady()&&(this.runtime?.allowContextRetrieval===false||!!this.runtime?.providedEvidence?.length);
		const initiallyInspected=this.retrieval?.inspected.size??0;
		const tools = this.retrieval&&!this.modelToolsClosed ? [this.historicalTool()] : this.retrieval?[]:this.getSceneMemory ? [this.sceneMemoryTool()] : [];
		const historyInstructions=this.retrieval ? " The search_scene_memory tool is replaced by retrieve_visual_history. Its use for historical place OR object questions overrides the earlier place-only restriction. Search using one short literal keyword, then call the SAME tool with ids to inspect candidate original images; you have permission, do not ask permission or stop at search hints. You have at most six tool turns: reserve one for inspection. Do not translate or combine synonyms in an AND keyword query. Add historicalEvidenceIds (only inspected IDs) and abstained boolean to JSON. For insufficient history abstain; historical sightings do not establish current presence. No match only means not retrieved, never that an object was absent from all history. For abstention say only that you cannot confirm the requested fact from retrieved/inspected evidence; do not summarize what the entire history contains or claim no signs exist anywhere. Never infer physical navigability from observed transitions." : "";
		const systemPrompt=(this.retrieval?SYSTEM_PROMPT.replace(/Reply with ONLY JSON:.*?No markdown\./,historicalSchema):SYSTEM_PROMPT)+historyInstructions;
		const agent = new Agent({ initialState: { systemPrompt, model: this.model, tools }, streamFn: this.streamFn });
		let turns=0;
		const unsubscribe=this.retrieval?agent.subscribe(event=>{
			if(event.type==="message_end"&&(event.message.role==="assistant"||event.message.role==="toolResult")){
				const message=event.message;this.onTrace?.({atMs:Date.now(),role:message.role,content:message.content.filter(block=>block.type!=="image"),...message.role==="assistant"?{usage:message.usage,stopReason:message.stopReason}:{} });
			}
			if(event.type==="turn_end"){
				turns++;
				if(event.toolResults.length&&evidenceReady()&&this.retrieval!.inspected.size>initiallyInspected){this.modelToolsClosed=true;agent.state.tools=[];agent.steer({role:'user',content:'All explicitly requested original evidence has now been viewed. Return the final JSON using those actual source IDs. Do not perform further searches or invent records.',timestamp:Date.now()});}
				if(turns===6&&event.toolResults.length){this.modelToolsClosed=true;agent.state.tools=[];agent.steer({role:"user",content:"Tool budget exhausted. Return final JSON now. If inspected evidence does not support a historical match, set abstained=true. Never guess additional IDs.",timestamp:Date.now()});}
				if(turns>=8)agent.abort();
			}
		}):()=>{};
		const timeout=this.retrieval?setTimeout(()=>agent.abort(),120000):null;
		if((this.runtime?.providedEvidence?.length??0)>6)throw Error('Provided evidence image budget exceeded');
		try{
			if(this.runtime?.providedEvidenceLabels||this.runtime?.currentEvidenceLabels){
				const supplied=this.runtime.providedEvidence??[];
				if(this.runtime.currentEvidenceLabels?.length!==imageContents.length||this.runtime.providedEvidenceLabels?.length!==supplied.length)throw Error('Evidence label/image count mismatch');
				const content=[...imageContents,...supplied].flatMap((image,index)=>[{type:'text' as const,text:index<imageContents.length?this.runtime!.currentEvidenceLabels![index]!:this.runtime!.providedEvidenceLabels![index-imageContents.length]!},image]);
				await agent.prompt({role:'user',content:[{type:'text',text:prompt},...content],timestamp:Date.now()});
			}else await agent.prompt(prompt, [...imageContents,...this.runtime?.providedEvidence??[]]);
		}finally{if(timeout)clearTimeout(timeout);unsubscribe();}
		if (agent.state.errorMessage) throw new Error(`RequestAgent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("RequestAgent returned no assistant message");
		let raw = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if(this.retrieval){
			const validate=(text:string)=>{parseRequest(text,this.state.mode==='watch'?'watch':null);const r=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(typeof r.abstained!=='boolean')throw Error('Missing abstention flag');if(!r.abstained||r.historicalEvidenceIds?.length)this.retrieval!.validateCitations(r.historicalEvidenceIds??[],r.abstained);if(!r.abstained&&this.runtime?.requiredEvidenceIds?.some(id=>!r.historicalEvidenceIds?.includes(id)))throw Error('Missing explicitly required source citation');};
			try{validate(raw);}catch(failure){
				const original=raw;this.onTrace?.({operation:'locked-protocol-original',raw:original,error:String(failure)});
				const repairTimeout=setTimeout(()=>agent.abort(),120000);
				try{
					// One bounded continuation; same already delivered images, no new retrieval.
					JSON.parse(original.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
					this.modelToolsClosed=true;agent.state.tools=[];
					await agent.prompt(`METADATA-ONLY PROTOCOL REPAIR. Original answer and every nonmetadata field are immutable. Return ONLY JSON {"historicalEvidenceIds":[...],"abstained":boolean}. Cite only actually viewed source IDs: ${JSON.stringify([...this.retrieval.inspected])}. Required sources for a nonabstaining answer: ${JSON.stringify(this.runtime?.requiredEvidenceIds??[])}. Set abstained consistently with the LOCKED original answer, not to escape missing evidence. No invented citations, no new facts, no answer field. Original JSON: ${original}`);
					if(agent.state.errorMessage)throw Error(agent.state.errorMessage);
					const last=[...agent.state.messages].reverse().find(m=>m.role==='assistant');
					if(!last||last.role!=='assistant')throw Error('Missing metadata patch');
					this.onTrace?.({atMs:Date.now(),role:'assistant',content:last.content,usage:last.usage,stopReason:last.stopReason,phase:'locked-protocol'});
					const patch=last.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');const repaired=lockedProtocolPatch(original,patch);validate(repaired);raw=repaired;
					this.onTrace?.({operation:'locked-protocol-accepted',originalRaw:original,patchRaw:patch,raw});
				}catch(error){this.onTrace?.({operation:'locked-protocol-failed',originalRaw:original,error:String(error)});throw new HistoricalAnswerValidationError(String(error),original);}finally{clearTimeout(repairTimeout);}
			}
		}
		let parsed:ReturnType<typeof parseRequest>;
		try{parsed=parseRequest(raw,this.state.mode === "watch" ? "watch" : null);}
		catch(error){if(this.retrieval)throw new HistoricalAnswerValidationError(error instanceof Error?error.message:String(error),raw);throw error;}
		let historicalEvidenceIds:string[]|undefined;
		if(this.retrieval){
			try{
			const root=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as {historicalEvidenceIds?:string[];abstained?:boolean};
			historicalEvidenceIds=root.historicalEvidenceIds ?? [];
			if(historicalEvidenceIds.length)this.retrieval.validateCitations(historicalEvidenceIds);
			if(typeof root.abstained!=="boolean")throw new Error("Historical request needs explicit abstention flag");
			if(root.abstained!==true)this.retrieval.validateCitations(historicalEvidenceIds);
			}catch(error){throw new HistoricalAnswerValidationError(error instanceof Error?error.message:String(error),raw);}
		}

		// A watch condition fires once; a question is done after answering.
		const shouldSpeak = parsed.kind === "watch" ? parsed.shouldSpeak && !this.state.spoken : parsed.shouldSpeak;
		const done = parsed.done || (parsed.kind === "watch" && shouldSpeak) || parsed.kind === "question";
		const turn: RequestTurn = { atMs: Date.now(), kind: parsed.kind, answer: parsed.answer, shouldSpeak, done, confidence: parsed.confidence };
		this.state.kind = parsed.kind;
		this.state.lastAnswer = parsed.answer;
		if (shouldSpeak) this.state.spoken = true;
		this.state.turns.push(turn);
		if (done) this.state.status = "done";
		this.state.updatedAtMs = Date.now();

		const messages=agent.state.messages.filter(message=>message.role==="assistant");
		return { ...parsed, shouldSpeak, done, frameIds: [ordered[ordered.length - 1]!.id], raw, ...historicalEvidenceIds?{historicalEvidenceIds}:{} ,...this.retrieval?{historicalTrace:{inspectedIds:[...this.retrieval.inspected],modelCalls:messages.length,tokens:messages.reduce((sum,message)=>sum+message.usage.totalTokens,0),elapsedMs:Date.now()-started}}:{} };
	}
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SpatialDecision, SpatialObservation, SpatialRecognizer, SpatialSnapshot } from "./incremental-spatial-memory.js";

export const INCREMENTAL_SPATIAL_PROMPT = `你根据逐步到达的观察识别观察者实际所在的具体物理区域。左/前/右三视图是同一时刻一个位置，不是三个区域。不使用坐标，不按功能名称强行拆开开放连通客餐厨；不同房间共享可见家具或隔门视野不证明观察者在同一区域。旋转或新物体出现本身不构成区域变化。只使用当前及已到达证据，不推测未来。
输出纯JSON：{"kind":"same|known|new|unknown","placeId":null,"summary":"当前可见区域的简洁描述","reason":"具体布局/墙体/开口/家具实例证据"}。
same仅指currentPlaceId非空的当前区域；known必须给目录中的准确placeId；new需正面证据建立不同具体区域（首次观察可由当前布局建立候选），不能仅因匹配失败而新建；证据不足unknown。same/new/unknown的placeId必须null。summary描述当前观察可支持的内容，不复制未见历史物体，不把历史状态说成当前状态。目录可能只提供文字摘要，缺参考图时不要凭功能名称确认身份。`;

export function validateSpatialDecision(value: unknown, history: SpatialSnapshot): SpatialDecision {
	if (!value || typeof value !== "object") throw new Error("Expected decision object");
	const r = value as Record<string, unknown>;
	if (!["same", "known", "new", "unknown"].includes(String(r.kind)) || typeof r.summary !== "string" || typeof r.reason !== "string" || !r.reason.trim()) throw new Error("Invalid kind/summary/reason");
	if (r.kind === "same" && !history.currentPlaceId) throw new Error("same requires currentPlaceId");
	if (r.kind === "known") {
		if (typeof r.placeId !== "string" || !history.places.some(p => p.id === r.placeId)) throw new Error("known requires supplied placeId");
	} else if (r.placeId !== null) throw new Error("placeId must be null except known");
	return { kind: r.kind as SpatialDecision["kind"], summary: r.summary, reason: r.reason, ...(r.kind === "known" ? { placeId: r.placeId as string } : {}) };
}

/** Direct OpenAI-compatible calls, no hidden retries. At most one protocol repair. */
export function createIncrementalSpatialVlm(logRoot: string, maxReferencePlaces = 4): SpatialRecognizer {
	if (!Number.isInteger(maxReferencePlaces) || maxReferencePlaces < 1) throw new Error("Invalid reference budget");
	return async (observation: SpatialObservation, history: SpatialSnapshot) => {
		const key = process.env.QWEN_API_KEY, base = process.env.QWEN_BASE_URL;
		if (!key || !base) throw new Error("QWEN_API_KEY/QWEN_BASE_URL missing");
		const directory = join(logRoot, `${history.records.length}-${Date.now()}-${crypto.randomUUID()}`);
		await mkdir(directory, { recursive: true });
		const candidates = [...history.places].sort((a, b) => Number(b.id === history.currentPlaceId) - Number(a.id === history.currentPlaceId) || b.lastSeenMs - a.lastSeenMs).slice(0, maxReferencePlaces);
		const content: Array<Record<string, unknown>> = [{ type: "text", text: INCREMENTAL_SPATIAL_PROMPT + "\n" + JSON.stringify({ currentPlaceId: history.currentPlaceId, catalog: history.places.map(p => ({ id: p.id, summary: p.summary, lastSeenMs: p.lastSeenMs })), recent: history.records.map(r => ({ id: r.observation.id, atMs: r.observation.atMs, placeId: r.placeId, reason: r.decision.reason })) }) }];
		const images: Array<{ label: string; path: string }> = [];
		const sent = new Set<string>();
		const add = async (label: string, row: SpatialObservation) => {
			content.push({ type: "text", text: label + " " + row.id + " atMs=" + row.atMs });
			for (const path of row.frames) {
				if (sent.has(path)) continue;
				sent.add(path);
				const evidence = row.evidence?.find(e => e.path === path);
				if (evidence) content.push({ type: "text", text: `TEMPORAL_EVIDENCE ${evidence.id} atMs=${evidence.atMs}; decide identity ONLY for latest target ${observation.id}, not this entire evidence bundle.` });
				const mime = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg";
				content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${(await readFile(path)).toString("base64")}` } });
				images.push({ label, path });
			}
		};
		await add("CURRENT (multiple frames, if present, are chronological evidence ending now)", observation);
		for (const row of history.records.slice(-1)) await add("RECENT", row.observation);
		for (const place of candidates.slice(0, 3)) {
			const first = place.representatives[0], last = place.representatives.at(-1);
			if (first) await add(`HISTORICAL_PLACE ${place.id}`, first);
			if (last && last.id !== first?.id) await add(`HISTORICAL_PLACE ${place.id}`, last);
		}
		await writeFile(join(directory, "input.json"), JSON.stringify({ prompt: INCREMENTAL_SPATIAL_PROMPT, observation, history, images, model: "qwen3.8-flash", temperature: 0, maxProtocolRepairs: 1 }, null, 2));
		const messages: Array<Record<string, unknown>> = [{ role: "user", content }];
		for (let attempt = 0; attempt < 2; attempt++) {
			const started = Date.now();
			let response;
			try {
				response = await fetch(base.replace(/\/$/, "") + "/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen3.8-flash", messages, temperature: 0, max_tokens: 1200 }), signal: AbortSignal.timeout(120_000) });
				if (!response.ok) throw new Error(`VLM HTTP ${response.status}`);
			} catch (error) {
				await writeFile(join(directory, `failure-${attempt}.json`), JSON.stringify({ type: (error as Error).name, elapsedMs: Date.now() - started }));
				throw error;
			}
			const raw = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
			await writeFile(join(directory, `response-${attempt}.json`), JSON.stringify({ response: raw, elapsedMs: Date.now() - started }, null, 2));
			const text = raw.choices?.[0]?.message?.content ?? "";
			try { return validateSpatialDecision(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), history); }
			catch (error) {
				if (attempt === 1) throw error;
				messages.push({ role: "assistant", content: text }, { role: "user", content: `协议错误：${(error as Error).message}。仅修正格式/合法ID，不增加证据。返回完整JSON。` });
			}
		}
		throw new Error("No valid decision");
	};
}

import type { FrameRef } from "./types.js";
import type { SceneChangeAgent } from "./scene-change-agent.js";
import type { RetrievalSession } from "./spatial-retrieve.js";
import type { SpatialEventStore } from "./spatial-event-store.js";

/** Simulator-only bridge. Unknown identity never falls through to a shared default baseline. */
export async function compareSpatialHistory(agent:Pick<SceneChangeAgent,"observe"|"resetBaseline">,session:RetrievalSession,frames:FrameRef[],placeId:string|null,events?:SpatialEventStore,current?:{id:string;recordingId?:string}){
	if(!placeId||!frames.length)return {status:"unknown",reason:"No confirmed observation identity/current frames",evidenceIds:[]};
	const beforeMs=Math.min(...frames.map(f=>f.timestampMs));
	const baseline=session.baseline(placeId,beforeMs);
	if(!baseline)return {status:"unknown",reason:"No earlier evidence for this identity",evidenceIds:[]};
	// Mark the selected evidence read under the same budget before passing its trusted path.
	await session.inspect([baseline.observation.id]);
	agent.resetBaseline(placeId);
	// Simulator frame order is front,left,right. Do not compare the old front to the new right.
	const result=await agent.observe([frames[0]!],null,placeId,null,baseline.observation.frames[0]!);
	if(events&&current)events.record({observationId:current.id,baselineId:baseline.observation.id,placeId,...current.recordingId!==undefined?{recordingId:current.recordingId}:{},atMs:beforeMs,changed:result.changed,what:result.what,result});
	return {status:"compared",evidenceIds:[baseline.observation.id],baselineAtMs:baseline.observation.atMs,result,note:"Different viewpoints can be inconclusive; not a current object inventory."};
}

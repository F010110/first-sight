import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import type {AgentResult,ThreeAgentStore} from './three-agent-store.js';

/** Persist facts unchanged; an unresolved relation is not a reason to re-describe the window. */
export function finalizeObservationFacts(store:ThreeAgentStore,rows:SpatialObservation[],extracted:Array<{observationId:string;result:AgentResult}>,hasHistory:boolean){
 if(hasHistory)store.ensureReview(rows.at(-1)!.id,'cross-window-identity-not-yet-reviewed');
 return extracted;
}
export function needsRelationshipReview(text:string){
 return /来过|重访|同一|同一个|上次|最后|拿走|放哪|放到|移到|移动.*(物|东西)|钥匙|杯子|物品|revisit|same (room|object)|last seen|where.*(key|cup|phone)/i.test(text);
}

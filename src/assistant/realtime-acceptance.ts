import type {streamEfficiency} from './stream-efficiency.js';

export const realtimeSLO={minimumSourceDurationMs:1200000,factP95Ms:2500,factMaxMs:8000,peakUnfinished:4,tailBacklogSlopePerMinute:.5,catchUpMs:5000,maxArrivalLateMs:250,ordinaryInteractionMaxMs:5000};
/** Fixed before soak results. This certifies a measured fact-processing workload,
 * not infinite duration, hard deadlines, event accuracy or confirmed identities. */
export function assessRealtime(metrics:ReturnType<typeof streamEfficiency>,expected:number,schedule:Array<{arrivalLateMs:number}>,slo=realtimeSLO){
 const checks={
  sourceClock:metrics.clock==='source-paced-host-wall',
  duration:metrics.sourceDurationMs>=slo.minimumSourceDurationMs,
  complete:metrics.inputObservations===expected&&metrics.completedObservations===expected&&metrics.extractedObservations===expected&&metrics.completedCoverage===1,
  zeroFailures:metrics.failedTasks===0&&metrics.failedBatches===0,
  factP95:metrics.observationEndToEndMs.p95!==null&&metrics.observationEndToEndMs.p95<=slo.factP95Ms,
  factMax:metrics.observationEndToEndMs.max!==null&&metrics.observationEndToEndMs.max<=slo.factMaxMs,
  boundedBacklog:metrics.unfinishedCount.max!==null&&metrics.unfinishedCount.max<=slo.peakUnfinished,
  noGrowingTail:metrics.tailBacklogSlopeObservationsPerMinute!==null&&metrics.tailBacklogSlopeObservationsPerMinute<=slo.tailBacklogSlopePerMinute,
  caughtUp:metrics.catchUpMs!==null&&metrics.catchUpMs<=slo.catchUpMs,
  inputNotStretched:schedule.length===expected&&schedule.every(s=>Number.isFinite(s.arrivalLateMs)&&Math.abs(s.arrivalLateMs)<=slo.maxArrivalLateMs),
  interaction:metrics.interactions.length>0&&metrics.interactions.every(i=>i.status==='completed'&&i.elapsedMs!==null&&i.elapsedMs<=slo.ordinaryInteractionMaxMs)
 };
 return {schema:'realtime-fact-acceptance-v1',passed:Object.values(checks).every(Boolean),checks,slo,scope:'Measured source-paced observation-fact processing; NOT hard real-time, indefinite stability, or semantic event/identity accuracy',semanticAccuracy:metrics.semanticAccuracy,relationshipStatus:metrics.relationshipStatus};
}

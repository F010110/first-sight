type Event={atMs:number;kind:string;value:any};
function distribution(values:number[]){
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
 const percentile=(p:number)=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]!:null;
 return {count:sorted.length,p50:percentile(.5),p95:percentile(.95),max:sorted.at(-1)??null};
}

/** Metrics are separated by clock and denominator; they are not semantic accuracy scores. */
export function streamEfficiency(events:Event[],sourcePaced:boolean,interactionJournal:Event[]=[]){
 const select=(kind:string)=>events.filter(e=>e.kind===kind);
 const archives=select('archive'),commits=select('memory-committed'),batches=select('batch-claimed');
 const progress=select('progress');const ending=select('source-ended').at(-1),drained=select('drain-finished').at(-1);
 const caughtUp=ending?progress.find(e=>e.atMs>=ending.atMs&&e.value.unfinished===0):undefined;
 const first=archives[0]?.atMs,last=archives.at(-1)?.atMs;
 const duration=first===undefined||last===undefined?0:last-first;
 const tail=progress.filter(e=>last!==undefined&&e.atMs<=last&&e.atMs>=last-60000);
 let slope:number|null=null;
 if(tail.length>=3){
  const xs=tail.map(e=>(e.atMs-tail[0]!.atMs)/60000),ys=tail.map(e=>e.value.unfinished as number);
  const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
  const denominator=xs.reduce((n,x)=>n+(x-mx)**2,0);
  if(denominator)slope=xs.reduce((n,x,i)=>n+(x-mx)*(ys[i]!-my),0)/denominator;
 }
 const during=commits.filter(e=>last!==undefined&&e.atMs<=last);
 const ids=new Set(archives.map(e=>e.value.id));
 const failed=select('memory-failed').length+select('extraction-failed').length+select('batch-failed').reduce((n,e)=>n+(e.value.ids?.length??1),0);
 const parallel=select('extraction-started').length>0;let activeExtractions=0,peakExtractions=0;
 for(const e of events){if(e.kind==='extraction-started')peakExtractions=Math.max(peakExtractions,++activeExtractions);if(e.kind==='extraction-inference')activeExtractions--;}
 const interactions=interactionJournal.filter(e=>e.kind==='task-created').map(start=>{
  const end=interactionJournal.find(e=>e.kind==='task-settled'&&e.value.id===start.value.id);
  return {id:start.value.id,status:end?.value.status??'pending',elapsedMs:end?end.atMs-start.atMs:null};
 });
 const result={
  clock:sourcePaced?'source-paced-host-wall':'not-source-paced',sourceDurationMs:duration,
  archival:distribution(archives.map(e=>e.value.archiveMs)),
  batchSize:distribution(batches.map(e=>e.value.ids.length)),
  windowCollectionSpanMs:distribution(batches.map(e=>e.value.collectionSpanMs)),
  collectionAndQueueMs:distribution(batches.map(e=>e.value.collectionAndQueueMs)),
  schedulerWaitMs:distribution(select(parallel?'extraction-started':'batch-started').map(e=>e.value.schedulerWaitMs)),
  batchInferenceMs:distribution(select(parallel?'extraction-inference':'batch-inference').map(e=>e.value.inferenceMs)),
  parallelExtraction:parallel,peakExtractionConcurrency:peakExtractions,
  extractionInferenceMs:distribution(select('extraction-inference').map(e=>e.value.inferenceMs)),
  associationInferenceMs:distribution(select('association-inference').map(e=>e.value.inferenceMs)),
  extractionLagMs:distribution(progress.map(e=>e.value.extractionLagMs).filter(x=>x!==null&&x!==undefined)),
  extractedObservations:new Set(select('extraction-committed').map(e=>e.value.id)).size,
  observationEndToEndMs:distribution(commits.map(e=>e.atMs-e.value.sourceAtMs)),
  semanticLagMs:distribution(progress.map(e=>e.value.semanticLagMs).filter(x=>x!==null)),
  observationFactLagMs:distribution(progress.map(e=>e.value.semanticLagMs).filter(x=>x!==null)),
  relationshipStatus:select('relationship-status').at(-1)?.value??null,
  completionScope:'observation facts, not verified place/object identities',
  oldestUnfinishedAgeMs:distribution(progress.map(e=>e.value.oldestUnfinishedAgeMs)),
  unfinishedCount:distribution(progress.map(e=>e.value.unfinished)),
  tailBacklogSlopeObservationsPerMinute:slope,
  inputObservations:ids.size,completedObservations:new Set(commits.map(e=>e.value.id)).size,
  startupToFirstSemanticMs:first===undefined||!commits.length?null:commits[0]!.atMs-first,
  inputRatePerSecond:duration>0?(archives.length-1)/(duration/1000):null,
  committedDuringInputPerSecond:duration>0?during.length/(duration/1000):null,
  completedFractionAtInputEnd:ids.size?new Set(during.map(e=>e.value.id)).size/ids.size:null,
  inferenceDemandToInputDurationRatio:duration>0?events.filter(e=>['batch-inference','extraction-inference','association-inference'].includes(e.kind)).reduce((n,e)=>n+e.value.inferenceMs,0)/duration:null,
  completedCoverage:ids.size?new Set(commits.map(e=>e.value.id)).size/ids.size:null,
  currentResultAgeMs:distribution(select('current-finished').map(e=>e.value.ageMs)),
  currentFreshFraction:select('current-finished').length?select('current-finished').filter(e=>e.value.fresh).length/select('current-finished').length:null,
  currentFailedAttempts:select('current-failed').filter(e=>!String(e.value.error).includes('superseded before model start')).length,
  currentSkippedBeforeInference:select('current-skipped').length+select('current-failed').filter(e=>String(e.value.error).includes('superseded before model start')).length,
  questionModelLaneMs:distribution(select('question-finished').map(e=>e.value.elapsedMs)),
  interactionEndToEndMs:distribution(interactions.map(t=>t.elapsedMs).filter((t):t is number=>t!==null)),
  interactions,
  catchUpMs:ending?(ending.value.unfinished===0?0:caughtUp?caughtUp.atMs-ending.atMs:drained?.value.unfinished===0?drained.atMs-ending.atMs:null):null,
  allWorkersDrainMs:ending&&drained?drained.atMs-ending.atMs:null,
  failedTasks:failed,
  failedBatches:select('batch-failed').length,
  throughputAssessment:failed?'degraded-failures':!sourcePaced||duration<60000||batches.length<5?'insufficient-evidence':slope!==null&&slope>1?'backlog-growing':'needs-slo-review',
  semanticAccuracy:'not-evaluated',
  notes:['Collection span is first-to-last arrival, not single-observation inference latency.','Collection-and-queue includes waiting for window closure and earlier memory work.','Semantic lag uses the contiguous completed prefix: later commits cannot hide gaps.','Question lane excludes Planner; interaction end-to-end includes routing, queueing and delivery.','Lag percentiles use event-time samples, not uniform time weighting.','Inference demand sums worker time, not wall occupancy when workers overlap.','Parallel extracted evidence is distinct from ordered semantic association.','Finite coverage after drain is not proof of sustained real-time throughput.']
 };
 return result;
}

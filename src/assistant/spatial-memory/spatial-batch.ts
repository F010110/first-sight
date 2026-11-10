import type {Assessment,Facts} from './contracts.js';

/** Facts-first input: original image paths are deliberately not in this contract. */
export type SpatialEvidenceBatch={id:string;observations:Array<{id:string;atMs:number;facts:Facts|null}>;skippedBefore?:Array<{id:string;atMs:number;facts:Facts|null}>;coverage?:{firstSequence:number;lastSequence:number;gapBefore:boolean};missingFactIds?:string[];revisionOfVersions?:number[]};
export type SpatialBatchSegment={observationIds:string[];assessment:Assessment};

/** Structural coverage only. Identity and visual support remain agent/tool responsibilities. */
export function validateBatchCoverage(batch:SpatialEvidenceBatch,segments:SpatialBatchSegment[]){
 const ids=batch.observations.map(o=>o.id);
 if(!ids.length||new Set(ids).size!==ids.length||batch.observations.some((o,i)=>i>0&&o.atMs<=batch.observations[i-1]!.atMs))throw Error('Invalid chronological batch');
 if(!segments.length)throw Error('Batch needs spatial segments');
 let cursor=0;
 for(const segment of segments){
  if(!segment.observationIds.length)throw Error('Empty spatial segment');
  for(const id of segment.observationIds)if(id!==ids[cursor++])throw Error(`Segments must cover batch exactly once in order. Expected next observation ID: ${JSON.stringify(ids[cursor-1])}; received ${JSON.stringify(id)}. Full batch IDs: ${JSON.stringify(ids)}`);
  const location=segment.assessment.location;
  if(!location||!location.sourceIds.includes(segment.observationIds.at(-1)!))throw Error('Segment must cite its tail source');
 }
 if(cursor!==ids.length)throw Error(`Incomplete spatial batch coverage. Covered ${cursor}/${ids.length}; remaining: ${JSON.stringify(ids.slice(cursor))}`);
 return structuredClone(segments);
}

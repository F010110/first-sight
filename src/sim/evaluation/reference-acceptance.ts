/** Apply the user's accepted corrections to a published reference sample without
 * rewriting the immutable sample file. Corrections change only the reference used
 * for evaluation; original observations, maps and hashes stay untouched.
 *
 * Acceptance schema: unioncity-annotation-acceptance-v1. A correction moves a
 * segment's start later on the presentation clock; frames that were previously
 * attributed to that segment but now fall before the accepted start inherit the
 * immediately preceding segment's annotation.
 */
export type UserAcceptance={
  schema:string;sampleId:string;date?:string;overallAccepted:boolean;
  corrections?:Array<{segmentId:string;label?:string;presentationStartMs:number;sourceStartMs?:number;scope?:string}>;
  remainingAnnotations?:string;segmentationPolicy?:Record<string,unknown>;
};

export type AppliedCorrection={segmentId:string;previousSegmentId:string|null;fromStartIndex:number;toStartIndex:number;fromStartMs:number;toStartMs:number;movedFrames:string[]};

export function applyUserAcceptance(sample:any,acceptance:UserAcceptance){
  if(!sample||!Array.isArray(sample.frames)||!Array.isArray(sample.segments))throw Error('Reference sample needs frames and segments');
  if(acceptance?.schema!=='unioncity-annotation-acceptance-v1'||acceptance.overallAccepted!==true)throw Error('Require an accepted user annotation version');
  if(typeof acceptance.sampleId!=='string'||sample.id!==acceptance.sampleId)throw Error('Acceptance sampleId does not match the reference sample');
  const accepted=structuredClone(sample),applied:AppliedCorrection[]=[];
  for(const correction of acceptance.corrections??[]){
    if(typeof correction?.segmentId!=='string'||!Number.isFinite(correction.presentationStartMs)||correction.presentationStartMs<0)throw Error('Invalid user correction');
    const segment=accepted.segments.find((s:any)=>s.id===correction.segmentId);
    if(!segment)throw Error('Correction references an unknown segment: '+correction.segmentId);
    const target=accepted.frames.findIndex((f:any)=>Number.isFinite(f.atMs)&&f.atMs>=correction.presentationStartMs);
    if(target<0)throw Error('Correction start lies after the last frame: '+correction.segmentId);
    if(target>segment.startIndex){
      const previous=accepted.segments
        .filter((s:any)=>s.id!==segment.id&&s.endIndex<segment.startIndex)
        .sort((a:any,b:any)=>b.endIndex-a.endIndex)[0];
      if(!previous)throw Error('Correction needs a preceding segment to absorb the moved frames');
      const template=structuredClone(accepted.frames[previous.endIndex].annotation);
      const moved:string[]=[];
      for(let i=segment.startIndex;i<target;i++){
        const frame=accepted.frames[i];
        if(frame?.annotation?.segmentId!==segment.id)continue;
        frame.annotation=structuredClone(template);
        moved.push(frame.id);
      }
      previous.endIndex=target-1;previous.endMs=accepted.frames[target-1].atMs;if(Number.isFinite(accepted.frames[target-1].sourceAtMs))previous.sourceEndMs=accepted.frames[target-1].sourceAtMs;
      applied.push({segmentId:segment.id,previousSegmentId:previous.id,fromStartIndex:segment.startIndex,toStartIndex:target,fromStartMs:segment.startMs,toStartMs:correction.presentationStartMs,movedFrames:moved});
    }else if(target!==segment.startIndex)throw Error('Correction moves a segment start backwards: '+correction.segmentId);
    segment.startIndex=target;segment.startMs=correction.presentationStartMs;
    if(Number.isFinite(correction.sourceStartMs))segment.sourceStartMs=correction.sourceStartMs;
    if(typeof correction.label==='string'&&correction.label.trim())segment.title=correction.label;
  }
  accepted.userAcceptance={
    schema:acceptance.schema,sampleId:acceptance.sampleId,date:acceptance.date??null,
    correctionsApplied:applied,
    note:acceptance.remainingAnnotations??'User-accepted reference; not independently verified human gold.',
    segmentationPolicy:acceptance.segmentationPolicy??null,
  };
  return {sample:accepted,applied};
}

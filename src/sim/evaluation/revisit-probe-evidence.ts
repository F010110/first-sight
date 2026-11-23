import {revisitProjection,type RevisitRecall} from '../../assistant/spatial-memory/revisit-candidates.js';

type Pair={placeId:string;channel:string;current:{id:string;direction:string};historical:{id:string;direction:string}};

/** Replace the frozen probe's original evidence declaration, not its instructions/history. */
export function replaceProbeEvidence(prompt:string,recall:RevisitRecall,pairs:Pair[]){
 const marker='Selected evidence pairs: ';
 const lines=prompt.split('\n');
 const declarations=lines.filter(line=>line.startsWith(marker));
 if(declarations.length!==1)throw Error('Expected exactly one frozen evidence declaration');
 // Verify the old declaration really is parseable; never silently append a second one.
 if(!Array.isArray(JSON.parse(declarations[0]!.slice(marker.length))))throw Error('Invalid frozen evidence declaration');
 const selected=pairs.map(p=>({placeId:p.placeId,channel:p.channel,current:{id:p.current.id,direction:p.current.direction},historical:{id:p.historical.id,direction:p.historical.direction}}));
 return {prompt:lines.map(line=>line.startsWith(marker)?marker+JSON.stringify(selected):line).join('\n'),revisit:revisitProjection(recall)};
}

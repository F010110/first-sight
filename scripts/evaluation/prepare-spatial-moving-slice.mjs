/** Select an unchanged contiguous public-input prefix/range; never adds oracle data. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [inputArg,outArg,startArg,countArg]=process.argv.slice(2);
const start=Number(startArg),count=Number(countArg);
if(!inputArg||!outArg||!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<1||count>16)throw Error('Usage: prepare-spatial-moving-slice PUBLIC-INPUT NEW-OUT START-INDEX COUNT(1..16)');
const bytes=await readFile(inputArg),input=JSON.parse(bytes.toString());
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||start+count>input.observations.length)throw Error('Invalid source range');
const observations=input.observations.slice(start,start+count);
const out=resolve(outArg);await mkdir(out,{recursive:false});
await writeFile(join(out,'input.json'),JSON.stringify({schema:input.schema,observations},null,2),{flag:'wx'});
await writeFile(join(out,'selection.json'),JSON.stringify({schema:'spatial-moving-slice-v1',parentInputSHA256:createHash('sha256').update(bytes).digest('hex'),parentCount:input.observations.length,startIndex:start,count,sourceIds:observations.map(r=>r.id),startMs:observations[0].atMs,lastMs:observations.at(-1).atMs,timestampsUnchanged:true,oracle:false,questions:false},null,2),{flag:'wx'});
console.log(JSON.stringify({out,start,count,startMs:observations[0].atMs,lastMs:observations.at(-1).atMs}));

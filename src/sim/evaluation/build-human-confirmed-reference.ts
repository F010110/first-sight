import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {applyUserAcceptance,type UserAcceptance} from './reference-acceptance.js';

/** Build the single human-confirmed reference used for judging.
 * The published assistant sample and the user acceptance record are immutable inputs;
 * this derived file is the only reference the judge should receive.
 */
const [samplePath,acceptancePath,outPath]=process.argv.slice(2);
if(!samplePath||!acceptancePath||!outPath)throw Error('Usage: build-human-confirmed-reference SAMPLE.json USER-ACCEPTANCE.json OUT.json');
const sampleBytes=await readFile(samplePath),acceptanceBytes=await readFile(acceptancePath);
const sample=JSON.parse(sampleBytes.toString()),acceptance=JSON.parse(acceptanceBytes.toString()) as UserAcceptance;
const {sample:accepted,applied}=applyUserAcceptance(sample,acceptance);
accepted.humanConfirmed={
  sourceSample:resolve(samplePath),sourceSampleSHA256:createHash('sha256').update(sampleBytes).digest('hex'),
  acceptance:resolve(acceptancePath),acceptanceSHA256:createHash('sha256').update(acceptanceBytes).digest('hex'),
  acceptedAt:acceptance.date??null,correctionsApplied:applied,
  authority:'User-accepted reference, not independently verified human gold',
  scope:'Evaluation only; never delivered to the spatial agent or question agent.',
};
await writeFile(outPath,JSON.stringify(accepted,null,2),{flag:'wx'});
console.log(JSON.stringify({out:resolve(outPath),correctionsApplied:applied,humanConfirmed:accepted.humanConfirmed},null,2));

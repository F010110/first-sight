import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {AuditBundle} from './holistic-memory-bundle.js';
import {groupedMemoryReport,readWindowVerdicts,renderGroupedMarkdown} from './grouped-memory-report.js';

// Free post-processing: reuse the already-paid per-window judge verdicts.
// No model call, no reference or observation is written.
const [judgeDir,referencePath,outArg]=process.argv.slice(2);
if(!judgeDir||!referencePath||!outArg||process.argv.length!==5)throw Error('Usage: run-grouped-memory-report JUDGE-DIR HUMAN-CONFIRMED-REFERENCE.json NEW-OUTPUT');
const bundle=JSON.parse((await readFile(join(judgeDir,'bundle.json'))).toString()) as AuditBundle;
const sample=JSON.parse((await readFile(referencePath)).toString());
const verdicts=await readWindowVerdicts(judgeDir);
const report=groupedMemoryReport(bundle,sample,verdicts);
await mkdir(outArg,{recursive:false});
await writeFile(join(outArg,'groups.json'),JSON.stringify(report,null,2),{flag:'wx'});
await writeFile(join(outArg,'groups.md'),renderGroupedMarkdown(report),{flag:'wx'});
console.log(JSON.stringify({groups:report.summary.groups,scored:report.summary.scoredGroups,mean:report.summary.meanGroupScore,median:report.summary.medianGroupScore,merges:report.merges.length,splits:report.splits.length,revisits:report.revisits.map(r=>`${r.referencePlace}:${r.verdict}`),out:outArg}));

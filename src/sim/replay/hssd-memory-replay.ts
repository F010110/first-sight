/** Image-only online cold start, real mid-sequence persistence/restart. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { VisualExperienceMemory } from "../../agent/visual-experience-memory.js";
import type { SegmentLink } from "../../agent/segment-association.js";
import type { VisualMotionStep } from "../../agent/visual-experience-pipeline.js";

const [directory, baselineDirectory, voPath, output, revisitPath, densePath, legacyTickMs, policy] = process.argv.slice(2);
if(policy && !["legacy-first-pair","recover-weak-anchors","updating-context","updating-context-v2"].includes(policy))throw new Error("Invalid anchor policy");
if (!directory || !baselineDirectory || !voPath || !output) throw new Error("Usage: hssd-memory-replay dataset baseline vo NEW-output");
const dir = resolve(directory), out = resolve(output);
const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const windows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const pairs = await read(resolve(baselineDirectory, "experience-directional-evidence.json"));
const geometry = await read(resolve(baselineDirectory, "local-rotation-evidence.json"));
const vo = await read(resolve(voPath));
if (vo.protocol !== "three-view-vo-v1") throw new Error("Invalid image VO");
const second = (values: number[]) => [...values].sort((a,b) => b-a)[1] ?? 0;
const links: SegmentLink[] = pairs.map((p: any, i: number) => ({ id: `visual-${i}`, a:p.a, b:p.b, kind:"visual", confidence:Math.min(second(p.bearings),second(p.backwardBearings ?? [])), source:"fresh-image-only-bidirectional", frames:p.views.map((v:any)=>v.frame) }));
for (const [i,p] of geometry.pairs.entries()) links.push({ id:`geometry-${i}`, a:p.a, b:p.b, kind:"geometric", confidence:1, source:p.source, frames:p.matches.flatMap((m:any)=>m.frames) });
if (revisitPath && revisitPath !== "-") {
  const revisit = await read(resolve(revisitPath));
  if (revisit.protocol !== "revisit-surface-geometry-v1") throw new Error("Invalid revisit evidence");
  for (const [i,p] of revisit.pairs.entries()) links.push({id:`revisit-${i}`,a:p.a,b:p.b,kind:"geometric",confidence:1,source:p.source,frames:p.matches.flatMap((m:any)=>m.frames)});
}
await mkdir(out, {recursive:false});
let memory = new VisualExperienceMemory();
const known = new Set<string>(), used = new Set<string>(), snapshots = [];
let restarted = false;
const dense = densePath && densePath !== "-" ? await read(resolve(densePath)) : null;
if(dense && dense.protocol!=="dense-coherent-context-evidence-v1")throw new Error("Invalid dense evidence");
const timestamp=(window:any)=>window.timestampMs??(legacyTickMs?window.endTick*Number(legacyTickMs):undefined);
const mapped=new Set<number>();
const mappedTargets=new Set<number>();
for (const [i,window] of windows.entries()) {
  if (!Number.isInteger(window.endTick) || window.endTick < 0 || i > 0 && window.endTick <= windows[i-1].endTick) throw new Error("Unordered observation ticks");
  const id = `observation-${i+1}`, previous = i > 0 ? windows[i-1].endTick : window.endTick;
  const steps: VisualMotionStep[] = vo.trace.filter((s:VisualMotionStep)=>Number(s.afterFrame.split(".")[0]) > previous && Number(s.afterFrame.split(".")[0]) <= window.endTick).map(({beforeFrame,afterFrame,status}:VisualMotionStep)=>({beforeFrame,afterFrame,status}));
  if (i > 0 && steps.length !== window.endTick-previous) throw new Error("Incomplete VO prefix");
  known.add(id);
  const available = links.filter(l=>known.has(l.a)&&known.has(l.b)&&!used.has(l.id));
  for (const l of available) used.add(l.id);
  const correspondences = pairs.filter((p:any)=>(p.a===id||p.b===id)&&known.has(p.a)&&known.has(p.b));
  const frames = ["left","frames","right"].map(view=>resolve(dir,view,`${String(window.endTick).padStart(4,"0")}.jpg`));
  const atMs = timestamp(window);
  if (!Number.isInteger(atMs) || atMs < 0 || i > 0 && atMs <= timestamp(windows[i-1])) throw new Error("Missing/or unordered original capture timestamps");
  const proposals=(dense?.events??[]).flatMap((event:any,n:number)=>{
    if(mapped.has(n)||event.confirmedTick* dense.tickMs>atMs)return [];
    const target=windows.findIndex((w:any)=>w.endTick>=event.beforeTick);
    if(target<=0||target>i)return [];
    mapped.add(n);
    if(mappedTargets.has(target))return [];
    mappedTargets.add(target);
    const frames=[...event.oldTicks,...event.newTicks].map((tick:number)=>resolve(dir,"frames",`${String(tick).padStart(4,"0")}.jpg`));
    return [{event:{id:`dense-context-${n}`,beforeObservationId:`observation-${target+1}`,source:"automatic" as const,reason:"Native-frame positively supported cohort departure; provisional context, not physical crossing",frames},availableAtMs:atMs}];
  });
  // Explicit projection: never reads collector trace, scene labels or simulator pose.
  const result = memory.observe({id,atMs,visitId:"hssd-tour",frames,objects:[],description:"",semanticSource:null},steps,[],available,correspondences,proposals,[],policy as "legacy-first-pair"|"recover-weak-anchors"|"updating-context"|"updating-context-v2"|undefined);
  snapshots.push({throughObservationId:id,atMs,assignments:result.grouping.assignments});
  if (i === Math.floor(windows.length/2)) {
    await memory.persist(resolve(out,"restart-checkpoint.json"));
    const before = JSON.stringify(memory.snapshot());
    const restored = new VisualExperienceMemory(); await restored.load(resolve(out,"restart-checkpoint.json"));
    if (JSON.stringify(restored.snapshot()) !== before) throw new Error("Persistence roundtrip changed memory");
    memory = restored; restarted = true;
  }
}
await memory.persist(resolve(out,"integrated-memory.json"));
await writeFile(resolve(out,"replay.json"), JSON.stringify({protocol:"hssd-image-online-replay-v1",online:{snapshots},grouping:memory.grouping(),restartRoundtripPassed:restarted,nativeContextEvidenceUsed:!!dense,timing:legacyTickMs?`Original legacy ${legacyTickMs}ms/capture tick preserved explicitly; not hardware latency.`:"Original 24fps simulation capture timestamps preserved, not measured hardware latency. Legacy diagnostic extractor replay uses synthetic tick timing; not used for these online results.",limitations:"New scene integration of frozen memory policy; no human correctness or cross-session new-trajectory revisit certified."},null,2),{flag:"wx"});
console.log(JSON.stringify({observations:windows.length,groups:memory.grouping()!.groups.length,restartRoundtripPassed:restarted}));

/** Zero-call causal audit of actual provider receipts, including short references. */
import {readFile,readdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const [root,output]=process.argv.slice(2);if(!root||!output)throw Error('Usage: audit-spatial-visit-context RUN NEW-report.json');
const input=JSON.parse(await readFile(join(root,'public-input.json'),'utf8'));
const strategy=JSON.parse(await readFile(join(root,'strategy.json'),'utf8'));
const rows=new Map(input.observations.map(r=>[r.id,r]));let requests=0,perceptions=0,contexts=0,relations=0;
const checks=[];
for(const entry of await readdir(join(root,'requests'),{withFileTypes:true})){
 if(!entry.isDirectory())continue;
 let raw;try{raw=await readFile(join(root,'requests',entry.name,'input.json'));}catch{continue;}
 const request=JSON.parse(raw.toString());requests++;
 const decode=new Map((request.metadata?.referenceBindings??[]).map(b=>[b.alias,b.originalId]));
 const original=id=>decode.get(id)??id;
 const current=rows.get(original(request.data.current.id));if(!current)throw Error('Unknown current receipt source');
 for(const image of request.images){const row=rows.get(original(image.id));if(!row||row.scene!==current.scene||row.atMs>current.atMs)throw Error('Future/cross-scene image receipt');const view=row.views.find(v=>v.direction===image.direction);if(!view||view.path!==image.path||view.sha256!==image.sha256)throw Error('Receipt differs from frozen public source');}
 if(request.phase==='perception'){perceptions++;if(request.data.visitMemory||request.images.some(i=>original(i.id)!==current.id))throw Error('Perception received history');}
 const memory=request.data.visitMemory;
 if(memory){contexts++;if(memory.recentVisits.length>6||memory.places.length>4)throw Error('Context cap exceeded');
  for(const visit of memory.recentVisits)if(visit.atMs>=current.atMs)throw Error('Future visit in context');
  for(const place of memory.places){if(place.lastVisitedMs>=current.atMs)throw Error('Future node');for(const edge of place.relations){relations++;if(edge.lastObservedMs>=current.atMs||edge.directTraversability!=='unknown')throw Error('Future or unsafe edge assertion');}}
  if(strategy.visitContext==='sequence'&&memory.places.some(p=>p.relations.length))throw Error('Sequence-only arm received graph edges');
 }
 checks.push({request:entry.name,sha256:createHash('sha256').update(raw).digest('hex')});
}
const report={schema:'spatial-visit-context-audit-v1',run:root,strategy,requests,perceptions,contexts,relations,modelCalls:0,causalInputChecksPassed:true,checks,note:'Receipt/schema audit, not spatial accuracy or invoice verification'};
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,checks:undefined}));

/** Local read-only artifact server: only generated report files and archive hashes. */
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export async function serveMemoryReport(runArg,port=8896){
 const root=await realpath(resolve(runArg));await readFile(join(root,'memory-review','index.html'));
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405);return res.end('Read-only report');}
  const path=new URL(req.url??'/','http://127.0.0.1').pathname;
  const name=path==='/'||path==='/index.html'?'memory-review/index.html':path==='/report.json'?'memory-review/report.json':/^\/originals\/[a-f0-9]{64}\.png$/.test(path)?path.slice(1):null;
  if(!name){res.writeHead(404);return res.end('Not found');}
  try{const file=await realpath(join(root,name)),rel=relative(root,file);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Outside archive');const bytes=await readFile(file);if(name.endsWith('.png')&&createHash('sha256').update(bytes).digest('hex')!==name.slice('originals/'.length,-4)){res.writeHead(409);return res.end('Archived image changed');}res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':name.endsWith('.json')?'application/json; charset=utf-8':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end('Not found');}
 });
 await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [run,portArg='8896']=process.argv.slice(2),port=Number(portArg);if(!run||!Number.isInteger(port)||port<1024||port>65535)throw Error('Usage: serve-memory-report RUN [PORT]');const server=await serveMemoryReport(run,port);console.log('只读Context / 长期记忆变化：http://127.0.0.1:'+port);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());}

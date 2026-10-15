import { readFile,writeFile } from "node:fs/promises";
import { SpatialSqliteStore } from "../agent/spatial-sqlite-store.js";
import type { TopologyState } from "../agent/spatial-topology-service.js";

const [action,database,file]=process.argv.slice(2);
if(!database || !file || !["import","export"].includes(action ?? ""))throw new Error("Usage: import|export database.sqlite snapshot.json (export never overwrites)");
const store=new SpatialSqliteStore(database);
try{
	if(action==="import")store.importSnapshot(JSON.parse(await readFile(file,"utf8")) as TopologyState);
	else await writeFile(file,JSON.stringify(store.exportSnapshot(),null,2),{flag:"wx"});
	console.log(JSON.stringify(store.counts()));
}finally{store.close();}

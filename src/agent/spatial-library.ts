import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const hash=(value:string)=>createHash("sha256").update(value).digest();
export class SpatialLibraryStore {
	constructor(private readonly root:string){}
	async create():Promise<{libraryId:string;recoveryKey:string}>{
		const libraryId=randomUUID(),recoveryKey=randomBytes(32).toString("base64url");
		const directory=join(this.root,libraryId);await mkdir(directory,{recursive:true});
		await writeFile(join(directory,"access.json"),JSON.stringify({version:1,recoveryHash:hash(recoveryKey).toString("hex")}),{flag:"wx",mode:0o600});
		return {libraryId,recoveryKey};
	}
	async open(libraryId:unknown,recoveryKey:unknown):Promise<string>{
		if(typeof libraryId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(libraryId) || typeof recoveryKey!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(recoveryKey))throw new Error("Invalid library credentials");
		try{
			const metadata=JSON.parse(await readFile(join(this.root,libraryId,"access.json"),"utf8")) as {version:number;recoveryHash:string};
			const expected=Buffer.from(metadata.recoveryHash,"hex");
			if(metadata.version!==1 || expected.length!==32 || !timingSafeEqual(expected,hash(recoveryKey)))throw new Error("Denied");
		}catch{throw new Error("Invalid library credentials");}
		return join(this.root,libraryId);
	}
}

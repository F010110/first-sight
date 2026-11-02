/** Versioned application data; never promoted to instructions or changed mid-request. */
export class RuntimeContextStore<T extends {current:{id:string;atMs:number}}> {
 private version=0;
 private value:T;
 constructor(initial:T){this.value=structuredClone(initial);}
 update(next:T){if(next.current.atMs<this.value.current.atMs)throw Error('Runtime context clock regression');this.value=structuredClone(next);this.version++;}
 snapshot(){return {version:this.version,data:structuredClone(this.value)};}
}

/** Field-level navigation errors; suggestions grant no new evidence permission. */
export function requireDeliveredIds(ids:unknown,max:number,delivered:ReadonlySet<string>,tool:string):string[]{
 const field=tool+'.ids',available=[...delivered],requested=JSON.stringify(ids);
 if(!Array.isArray(ids)||!ids.length||ids.length>max)throw Error(`${field}: expected 1–${max} observation IDs; received ${requested}. Available delivered observation IDs: ${JSON.stringify(available)}.`);
 const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
 if(duplicates.length)throw Error(`${field}: duplicate observation IDs ${JSON.stringify(duplicates)}; received ${requested}. Use distinct IDs.`);
 const invalid=ids.filter(id=>typeof id!=='string'||!delivered.has(id));
 if(invalid.length)throw Error(`${field}: observation IDs ${JSON.stringify(invalid)} have NOT been delivered in this judgment. Requested: ${requested}. Available delivered observation IDs: ${JSON.stringify(available)}. Choose a supporting delivered source, or use memory_place/memory_timeline/memory_find to deliver other historical sources before inspecting them. Do not substitute a placeId. After inspection, cite the supporting observation ID in location.sourceIds; prior-session visibility grants no current permission.`);
 return ids;
}

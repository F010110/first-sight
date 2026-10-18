/** Caller-owned clock metadata. Assumed calendar dates are never capture truth. */
export interface MemoryClock {
 kind:'captured'|'assumed'; sourceOriginMs:number; wallOrigin:string; offsetMinutes:number;
}
export function parseCalendarTime(value:string,offsetMinutes=0):number{
 if(!Number.isInteger(offsetMinutes)||Math.abs(offsetMinutes)>840)throw Error('Invalid timezone offset');
 const normalized=value.trim().replace(/年|月/g,'-').replace(/日\s*/,'T').replace(/时|点|分/g,':').replace(/秒$/,'');
 const match=normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2}):(\d{1,2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/);
 if(!match)throw Error('Use a full calendar date and time, e.g. 2026-10-18T09:00:00+08:00');
 const [,year,month,day,hour,minute,second,fraction,zone]=match;
 const parts=[year,month,day,hour,minute,second].map(Number);const [y,m,d,h,min,s]=parts;
 const local=Date.UTC(y!,m!-1,d!,h!,min!,s!,Math.round(Number(fraction??0)*1000));const date=new Date(local);
 if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m!-1||date.getUTCDate()!==d||date.getUTCHours()!==h||date.getUTCMinutes()!==min||date.getUTCSeconds()!==s)throw Error('Invalid calendar date');
 let offset=offsetMinutes;
 if(zone==='Z')offset=0;else if(zone){const hours=Number(zone.slice(1,3)),minutes=Number(zone.slice(4));if(hours>14||minutes>59||hours===14&&minutes!==0)throw Error('Invalid timezone');offset=(hours*60+minutes)*(zone[0]==='-'?-1:1);}
 return local-offset*60000;
}
export function wallTime(atMs:number,clock:MemoryClock):string{
 const unix=parseCalendarTime(clock.wallOrigin,clock.offsetMinutes)+atMs-clock.sourceOriginMs;
 const offset=clock.offsetMinutes,sign=offset<0?'-':'+';
 return new Date(unix+offset*60000).toISOString().replace('Z',`${sign}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`);
}
export function memoryTime(value:string,clock?:MemoryClock):number{
 const unix=parseCalendarTime(value,clock?.offsetMinutes??0);
 return clock?unix-parseCalendarTime(clock.wallOrigin,clock.offsetMinutes)+clock.sourceOriginMs:unix;
}
export function calendarFilters<T extends {query?:string;atTime?:string;afterTime?:string;beforeTime?:string;afterMs?:number;beforeMs?:number}>(input:T,clock?:MemoryClock):T{
 const {atTime,afterTime,beforeTime,...rest}=input;
 const explicit=atTime??(input.query&&/^\d{4}(?:-|年)/.test(input.query.trim())?input.query:undefined);
 if(explicit&&(afterTime!==undefined||beforeTime!==undefined||input.afterMs!==undefined||input.beforeMs!==undefined))throw Error('Exact time cannot be combined with range filters');
 if(afterTime!==undefined&&input.afterMs!==undefined||beforeTime!==undefined&&input.beforeMs!==undefined)throw Error('Choose calendar or numeric bounds, not both');
 if(explicit){const time=memoryTime(explicit,clock);return {...rest,...explicit===input.query?{query:undefined}:{},afterMs:time,beforeMs:time} as unknown as T;}
 return {...rest,...afterTime!==undefined?{afterMs:memoryTime(afterTime,clock)}:{},...beforeTime!==undefined?{beforeMs:memoryTime(beforeTime,clock)}:{}} as T;
}

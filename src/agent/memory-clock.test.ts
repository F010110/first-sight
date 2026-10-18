import {test} from 'node:test';import assert from 'node:assert/strict';
import {memoryTime,wallTime,calendarFilters,parseCalendarTime,type MemoryClock} from './memory-clock.js';
const clock:MemoryClock={kind:'assumed',sourceOriginMs:28800000,wallOrigin:'2026-10-18T09:00:00+08:00',offsetMinutes:480};
test('calendar mapping is reversible and preserves gaps without rewriting raw clocks',()=>{
 for(const time of [28800000,28800123,30177500,41269699])assert.equal(memoryTime(wallTime(time,clock),clock),time);
 assert.equal(memoryTime('2026年10月18日9时0分0秒',clock),28800000);
 assert.equal(wallTime(28800000,clock),'2026-10-18T09:00:00.000+08:00');
 assert.equal(parseCalendarTime('2026-10-18T01:00:00Z'),parseCalendarTime(clock.wallOrigin));
});
test('reject invalid dates, incomplete timestamps and conflicting filters',()=>{
 for(const text of ['2026-02-30T09:00:00Z','2026-10-18','2026-10-18T25:00:00Z','2026-10-18T09:00:00+15:00'])assert.throws(()=>memoryTime(text,clock));
 assert.throws(()=>calendarFilters({atTime:clock.wallOrigin,afterMs:0},clock));
 assert.deepEqual(calendarFilters({query:clock.wallOrigin},clock),{query:undefined,afterMs:28800000,beforeMs:28800000});
 assert.deepEqual(calendarFilters({query:'体育馆',afterTime:clock.wallOrigin},clock),{query:'体育馆',afterMs:28800000});
});

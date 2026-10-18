import {test} from 'node:test';import assert from 'node:assert/strict';
import {oracleSession} from './spatial-memory-evaluation-session.js';import {withCurrentEvidence} from './current-evidence-session.js';
test('delivered current frames are valid evidence but do not grant historical access',()=>{
 const base=oracleSession([],[],1,()=>{}),session=withCurrentEvidence(base,'current');
 assert.ok(session.inspected.has('current'));session.validateCitations(['current']);
 assert.throws(()=>session.validateCitations(['invented']),/Citations/);
 assert.throws(()=>session.validateCitations([]),/Citations/);
 assert.equal(base.inspected.has('current'),false);
});

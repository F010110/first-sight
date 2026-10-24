/** Deterministic local tests only; never run paid evaluation entry points. */
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function find(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? find(path) : entry.name.endsWith('.test.ts') ? [path.replace(/^src[\\/]/, 'dist/current/').replace(/\.ts$/, '.js')] : [];
  });
}
// Source inventory prevents stale or nested old builds from running twice.
const tests = find('src').sort();
if (!tests.length) throw new Error('Build produced no tests');
const result = spawnSync(process.execPath, ['--v8-pool-size=1', '--test', '--test-concurrency=1', ...tests], {stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

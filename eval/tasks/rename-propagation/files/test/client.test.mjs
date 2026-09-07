import assert from 'node:assert/strict';
import { buildRequest, DEFAULTS } from '../src/index.js';

assert.equal(DEFAULTS.timeout, 5000);
assert.equal(buildRequest({ timeout: 3000 }).body.timeout, 3000);
assert.equal(buildRequest().body.timeout, 5000);
assert.throws(() => buildRequest({ timeout: 0 }));

console.log('ok');

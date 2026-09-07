import assert from 'node:assert/strict';
import { isIgnored } from '../src/index.js';

assert.equal(isIgnored('app.log', ['*.log']), true);
assert.equal(isIgnored('app.txt', ['*.log']), false);

console.log('ok');

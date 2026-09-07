import assert from 'node:assert/strict';
import { graphemeLength, padEnd, reverse, truncate } from '../src/index.js';

assert.equal(graphemeLength('abc'), 3);
assert.equal(truncate('abcdef', 4), 'abc…');
assert.equal(reverse('abc'), 'cba');
assert.equal(padEnd('ab', 4), 'ab  ');

console.log('ok');

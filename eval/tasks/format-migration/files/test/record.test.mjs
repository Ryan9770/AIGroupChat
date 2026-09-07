import assert from 'node:assert/strict';
import { parse, serialize } from '../src/index.js';

const round = parse(serialize({ name: 'a', tags: ['x'] }));
assert.equal(round.name, 'a');
assert.deepEqual(round.tags, ['x']);

assert.deepEqual(parse(serialize({ name: 'b' })).tags, []);
assert.throws(() => serialize({ name: '' }));

console.log('ok');

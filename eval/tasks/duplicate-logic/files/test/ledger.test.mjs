import assert from 'node:assert/strict';
import { reduce } from '../src/index.js';

assert.equal(reduce([{ type: 'charge', amount: 100, date: '2026-01-04' }]).balance, 100);
assert.equal(
  reduce([
    { type: 'charge', amount: 100, date: '2026-01-04' },
    { type: 'payout', amount: 30, date: '2026-01-09' },
  ]).balance,
  70,
);
assert.equal(reduce([{ type: 'unknown', amount: 5, date: '2026-01-01' }]).balance, 0);

console.log('ok');

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBooleanFlag, parseBoundedNumber } from '../lib.mjs';

test('parseBoundedNumber returns defaults and valid values', () => {
  assert.equal(parseBoundedNumber(undefined, { name: 'wait', defaultValue: 0, min: 0, max: 60_000 }), 0);
  assert.equal(parseBoundedNumber('2500', { name: 'wait', defaultValue: 0, min: 0, max: 60_000 }), 2500);
});

test('parseBoundedNumber rejects NaN, fractions when integer, and out-of-range values', () => {
  const options = { name: 'max-pages', defaultValue: 8, min: 1, max: 50 };
  for (const value of ['wat', '1.5', '0', '51', '-1']) {
    assert.throws(() => parseBoundedNumber(value, options), /invalid max-pages/i);
  }
});

test('parseBooleanFlag accepts bare flags and rejects misleading values', () => {
  assert.equal(parseBooleanFlag(undefined, 'ignore-https-errors'), false);
  assert.equal(parseBooleanFlag(false, 'ignore-https-errors'), false);
  assert.equal(parseBooleanFlag(true, 'ignore-https-errors'), true);
  assert.throws(() => parseBooleanFlag('false', 'ignore-https-errors'), /does not accept a value/i);
});

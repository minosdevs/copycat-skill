import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveInside, validateSafeName } from '../lib.mjs';

test('resolveInside resolves safe descendants', () => {
  assert.equal(resolveInside('/tmp/output', 'screens', 'desktop'), '/tmp/output/screens/desktop');
});

test('resolveInside rejects traversal and absolute escape attempts', () => {
  for (const parts of [
    ['..', 'outside'],
    ['screens', '../../outside'],
    ['/etc/passwd'],
  ]) {
    assert.throws(() => resolveInside('/tmp/output', ...parts), /outside output directory/i);
  }
});

test('validateSafeName accepts output segments and rejects manifest traversal names', () => {
  assert.equal(validateSafeName('desktop', 'viewport'), 'desktop');
  assert.equal(validateSafeName('wide-screen_2', 'viewport'), 'wide-screen_2');
  for (const name of ['../../escape', '/absolute', 'a/b', '', '.']) {
    assert.throws(() => validateSafeName(name, 'viewport'), /invalid viewport/i);
  }
});

test('resolveInside rejects pre-existing symlink escapes below the output root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-path-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-outside-'));
  fs.symlinkSync(outside, path.join(root, 'screens'));
  assert.throws(() => resolveInside(root, 'screens', 'capture.png'), /symbolic link/i);
});

test('resolveInside rejects an output root that is itself a symbolic link', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-root-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-root-target-'));
  const linkedRoot = path.join(parent, 'output');
  fs.symlinkSync(outside, linkedRoot);
  assert.throws(() => resolveInside(linkedRoot, 'result.json'), /symbolic link/i);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { browserLaunchOptions, isSameSiteHost, isViewportComparisonComplete, newContext, parseViewports, validateViewport, validateViewportNames } from '../lib.mjs';

test('parseViewports accepts safe named viewports', () => {
  assert.deepEqual(parseViewports('wide-screen:1920x1080,mobile'), {
    'wide-screen': { width: 1920, height: 1080 },
    mobile: { width: 390, height: 844 },
  });
});

test('parseViewports rejects names that can escape the output directory', () => {
  assert.throws(
    () => parseViewports('../../outside:1920x1080'),
    /invalid viewport name/i,
  );
});

test('parseViewports rejects invalid and excessive dimensions', () => {
  for (const spec of [
    'tiny:0x1080',
    'negative:-1x1080',
    'nan:watx1080',
    'huge:100000x100000',
    'extra:800x600:ignored',
  ]) {
    assert.throws(() => parseViewports(spec), /invalid viewport dimensions/i);
  }
});

test('newContext verifies HTTPS certificates by default and allows explicit opt-out', async () => {
  const calls = [];
  const browser = { async newContext(options) { calls.push(options); return options; } };
  const viewport = { width: 1440, height: 900 };

  await newContext(browser, viewport);
  await newContext(browser, viewport, { ignoreHTTPSErrors: true });

  assert.equal(calls[0].ignoreHTTPSErrors, false);
  assert.equal(calls[1].ignoreHTTPSErrors, true);
});

test('isSameSiteHost accepts the exact host and real subdomains only', () => {
  assert.equal(isSameSiteHost('example.com', 'example.com'), true);
  assert.equal(isSameSiteHost('cdn.example.com', 'example.com'), true);
  assert.equal(isSameSiteHost('evilexample.com', 'example.com'), false);
  assert.equal(isSameSiteHost('example.com.evil.test', 'example.com'), false);
});

test('browserLaunchOptions supports a trusted executable browser path', () => {
  assert.deepEqual(browserLaunchOptions({ headed: false, 'executable-path': process.execPath }), {
    headless: true,
    executablePath: process.execPath,
    args: [],
  });
  assert.throws(
    () => browserLaunchOptions({ channel: 'chrome', 'executable-path': process.execPath }),
    /cannot be used together/i,
  );
  assert.throws(
    () => browserLaunchOptions({ 'executable-path': '/definitely/missing/chromium' }),
    /not a trusted executable/i,
  );
  assert.throws(() => browserLaunchOptions({ headed: 'false' }), /does not accept a value/i);
  assert.throws(() => browserLaunchOptions({ channel: 'firefox' }), /invalid browser channel/i);
});

test('validateViewport rejects hostile dimensions imported from a manifest', () => {
  assert.deepEqual(validateViewport({ width: 800, height: 600 }, 'desktop'), { width: 800, height: 600 });
  for (const viewport of [null, {}, { width: -1, height: 600 }, { width: 100000, height: 100000 }, { width: '800', height: 600 }]) {
    assert.throws(() => validateViewport(viewport, 'desktop'), /invalid viewport dimensions/i);
  }
});

test('isViewportComparisonComplete requires a real pixel diff and no errors', () => {
  assert.equal(isViewportComparisonComplete({ cloneFull: 'clone.png', diff: { mismatchPercent: 0 } }), true);
  assert.equal(isViewportComparisonComplete({ error: 'context failed' }), false);
  assert.equal(isViewportComparisonComplete({ cloneFull: null, diff: { error: 'screenshot failed' } }), false);
  assert.equal(isViewportComparisonComplete({ cloneFull: 'clone.png', diff: { error: 'original missing' } }), false);
  assert.equal(isViewportComparisonComplete({ cloneFull: 'clone.png', diff: {} }), false);
});

test('validateViewportNames rejects captures with no screenshots', () => {
  assert.deepEqual(validateViewportNames({ desktop: {} }), ['desktop']);
  assert.throws(() => validateViewportNames({}), /no screenshots/i);
  assert.throws(() => validateViewportNames(null), /no screenshots/i);
});

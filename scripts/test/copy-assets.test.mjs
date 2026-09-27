import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { copyManifestAssets } from '../copy-assets.mjs';

function fixture() {
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-capture-'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-destination-'));
  fs.mkdirSync(path.join(capture, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(capture, 'assets', 'images', 'hero.png'), 'image');
  return { capture, destination };
}

function writeManifest(capture, file) {
  fs.writeFileSync(path.join(capture, 'manifest.json'), JSON.stringify({ assets: [{ file }] }));
}

test('copyManifestAssets copies manifest assets inside the destination root', () => {
  const { capture, destination } = fixture();
  writeManifest(capture, 'assets/images/hero.png');

  assert.equal(copyManifestAssets(capture, destination), 1);
  assert.equal(fs.readFileSync(path.join(destination, 'images', 'hero.png'), 'utf8'), 'image');
});

test('copyManifestAssets rejects traversal and non-assets manifest paths', () => {
  const { capture, destination } = fixture();
  for (const file of ['../outside.txt', '/etc/passwd', 'content/page.html']) {
    writeManifest(capture, file);
    assert.throws(() => copyManifestAssets(capture, destination), /invalid asset path|outside/i);
  }
});

test('copyManifestAssets rejects source and destination symlink escapes', () => {
  const sourceCase = fixture();
  const outsideSource = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-source-outside-'));
  fs.writeFileSync(path.join(outsideSource, 'secret.txt'), 'secret');
  fs.symlinkSync(outsideSource, path.join(sourceCase.capture, 'assets', 'linked'));
  writeManifest(sourceCase.capture, 'assets/linked/secret.txt');
  assert.throws(() => copyManifestAssets(sourceCase.capture, sourceCase.destination), /symbolic link/i);

  const destinationCase = fixture();
  const outsideDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-destination-outside-'));
  fs.symlinkSync(outsideDestination, path.join(destinationCase.destination, 'images'));
  writeManifest(destinationCase.capture, 'assets/images/hero.png');
  assert.throws(() => copyManifestAssets(destinationCase.capture, destinationCase.destination), /symbolic link/i);

  const rootCase = fixture();
  const linkedDestination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-destination-link-')), 'output');
  const rootOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'copycat-destination-root-outside-'));
  fs.symlinkSync(rootOutside, linkedDestination);
  writeManifest(rootCase.capture, 'assets/images/hero.png');
  assert.throws(() => copyManifestAssets(rootCase.capture, linkedDestination), /symbolic link/i);
});

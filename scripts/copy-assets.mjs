#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ensureDir, readJson, resolveInside } from './lib.mjs';

function assetSegments(file) {
  if (typeof file !== 'string' || file.includes('\\') || path.posix.isAbsolute(file)) {
    throw new Error(`Invalid asset path: ${file}`);
  }
  const normalized = path.posix.normalize(file);
  if (normalized !== file || !normalized.startsWith('assets/') || normalized === 'assets/') {
    throw new Error(`Invalid asset path: ${file}`);
  }
  return normalized.slice('assets/'.length).split('/');
}

export function copyManifestAssets(captureDirectory, destinationDirectory) {
  const captureRoot = fs.realpathSync(captureDirectory);
  const destinationInput = path.resolve(destinationDirectory);
  if (fs.existsSync(destinationInput) && fs.lstatSync(destinationInput).isSymbolicLink()) {
    throw new Error(`Refusing symbolic link in destination root: ${destinationInput}`);
  }
  const destinationRoot = fs.realpathSync(ensureDir(destinationInput));
  const manifest = readJson(resolveInside(captureRoot, 'manifest.json'));
  if (!Array.isArray(manifest.assets)) throw new Error('Invalid manifest: assets must be an array');

  let copied = 0;
  for (const asset of manifest.assets) {
    if (!asset || !asset.file) continue;
    const segments = assetSegments(asset.file);
    const source = resolveInside(captureRoot, ...asset.file.split('/'));
    if (!fs.statSync(source).isFile()) throw new Error(`Asset is not a regular file: ${asset.file}`);

    const parent = resolveInside(destinationRoot, ...segments.slice(0, -1));
    ensureDir(parent);
    const destination = resolveInside(destinationRoot, ...segments);
    fs.copyFileSync(source, destination);
    copied++;
  }
  return copied;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [captureDirectory, destinationDirectory] = process.argv.slice(2);
  if (!captureDirectory || !destinationDirectory) {
    console.error('usage: node copy-assets.mjs <capture-dir> <destination-dir>');
    process.exit(1);
  }
  const copied = copyManifestAssets(captureDirectory, destinationDirectory);
  console.log(`copied ${copied} files to ${path.resolve(destinationDirectory)}`);
}

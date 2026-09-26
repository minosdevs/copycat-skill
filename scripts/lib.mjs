// Shared helpers for capture.mjs and compare.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1194 },
  mobile: { width: 390, height: 844 },
};

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key.startsWith('no-')) args[key.slice(3)] = false;
      else if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

export function parseViewports(spec) {
  if (!spec || spec === true) return DEFAULT_VIEWPORTS;
  const out = {};
  for (const part of String(spec).split(',')) {
    const [name, size] = part.split(':');
    if (size) {
      const [w, h] = size.split('x').map(Number);
      out[name] = { width: w, height: h };
    } else if (DEFAULT_VIEWPORTS[name]) out[name] = DEFAULT_VIEWPORTS[name];
  }
  return Object.keys(out).length ? out : DEFAULT_VIEWPORTS;
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
export function writeJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
export function slugify(s) {
  return String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'root';
}
export function pad2(n) { return String(n).padStart(2, '0'); }
export function fmtBytes(n) {
  if (n == null) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
export function log(...a) { console.error('[copycat]', ...a); }

export const EXTRACT_SRC = fs.readFileSync(path.join(__dirname, 'extract.browser.js'), 'utf8');

/** Run the in-page extractor. Works even under strict CSP (evaluate is not subject to script-src). */
export async function runExtract(page, opts = {}) {
  return page.evaluate(new Function('opts', EXTRACT_SRC + '\nreturn window.__copycatExtract(opts);'), opts);
}

/** Wire console / errors / network recorders on a page. Returns the collectors. */
export function attachRecorders(page) {
  const rec = { console: [], pageErrors: [], failedRequests: [], responses: [], requests: 0 };
  page.on('console', (msg) => {
    if (rec.console.length < 400) rec.console.push({ type: msg.type(), text: msg.text().slice(0, 500), location: msg.location()?.url ? `${msg.location().url}:${msg.location().lineNumber}` : null });
  });
  page.on('pageerror', (err) => { if (rec.pageErrors.length < 100) rec.pageErrors.push(String(err && err.message || err).slice(0, 800)); });
  page.on('requestfailed', (req) => { if (rec.failedRequests.length < 200) rec.failedRequests.push({ url: req.url().slice(0, 300), type: req.resourceType(), error: req.failure()?.errorText }); });
  page.on('request', () => { rec.requests++; });
  page.on('response', (res) => {
    if (rec.responses.length >= 1500) return;
    const req = res.request();
    let size = null;
    const cl = res.headers()['content-length'];
    if (cl) size = Number(cl);
    rec.responses.push({ url: res.url().slice(0, 300), status: res.status(), type: req.resourceType(), contentType: (res.headers()['content-type'] || '').split(';')[0], size });
  });
  return rec;
}

/** Hide cookie/consent overlays WITHOUT accepting anything (pure CSS hide, no consent given). */
export async function hideConsentOverlays(page) {
  try {
    return await page.evaluate(() => {
      const re = /cookie|consent|gdpr|onetrust|cookiebot|didomi|axeptio|tarteaucitron|cc-window|cc-banner|usercentrics|osano|iubenda|klaro|cky-|truste|privacy-banner|cmp-|trial-modal/i;
      let hidden = 0;
      const els = Array.from(document.querySelectorAll('body *'));
      for (const el of els) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky' && el.tagName !== 'DIALOG') continue;
        const hay = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '');
        const text = (el.innerText || '').slice(0, 400);
        if (re.test(hay) || (/cookie|consent/i.test(text) && /accept|agree|accepter|autoriser|allow|got it|ok/i.test(text))) {
          el.style.setProperty('display', 'none', 'important');
          hidden++;
        }
      }
      // some CMPs lock scroll with overflow:hidden on <html>/<body> — lift ONLY that, never touch a
      // normal overflow (setting overflow on both html and body turns body into the scroll container
      // and silently breaks window.scrollTo)
      if (hidden) {
        for (const el of [document.documentElement, document.body]) {
          if (getComputedStyle(el).overflowY === 'hidden') el.style.setProperty('overflow-y', 'visible', 'important');
        }
      }
      return hidden;
    });
  } catch { return 0; }
}

/** Scroll through the page to trigger lazy-loading / IntersectionObserver reveals, then back to top. */
export async function autoScroll(page, { stepRatio = 0.75, delay = 220, maxSteps = 120 } = {}) {
  await page.evaluate(async ({ stepRatio, delay, maxSteps }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const vh = window.innerHeight;
    let y = 0;
    let steps = 0;
    while (steps < maxSteps) {
      const max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - vh;
      if (y >= max) break;
      y = Math.min(y + vh * stepRatio, max);
      window.scrollTo(0, y);
      steps++;
      await sleep(delay);
    }
    await sleep(500);
    window.scrollTo(0, 0);
    await sleep(400);
  }, { stepRatio, delay, maxSteps });
  try { await page.evaluate(() => document.fonts.ready); } catch { }
}

/** goto with graceful fallbacks (networkidle → load → domcontentloaded). */
export async function robustGoto(page, url, { timeout = 45000, settle = 1500 } = {}) {
  let how = 'load';
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
  } catch (e) {
    how = 'domcontentloaded (load timed out)';
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout }); } catch (e2) { throw e2; }
  }
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); how += ' + networkidle'; } catch { how += ' (network never idle)'; }
  await page.waitForTimeout(settle);
  return how;
}

export async function newContext(browser, viewport, { scale = 1, locale = 'en-US', colorScheme = 'light', mobile = false } = {}) {
  return browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    userAgent: mobile ? USER_AGENT.replace('Windows NT 10.0; Win64; x64', 'Linux; Android 13; Pixel 7').replace('Safari/537.36', 'Mobile Safari/537.36') : USER_AGENT,
    isMobile: mobile,
    hasTouch: mobile,
    locale,
    colorScheme,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
}

/** Full-page screenshot with fallback when the page is too tall for Chromium's texture limit. */
export async function fullPageShot(page, file) {
  try {
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide', timeout: 60000 });
    return true;
  } catch (e) {
    log('full-page screenshot failed (' + String(e.message).split('\n')[0] + '), folds only');
    return false;
  }
}

/**
 * Viewport-by-viewport screenshots, taken while REALLY scrolled (so IntersectionObserver
 * reveal-on-scroll animations fire, unlike Chromium's native full-page capture).
 * From the 2nd fold on, fixed/sticky bars pinned to the top are hidden so the folds can be
 * stitched into a clean full-page image. Returns {shots:[{file,y,h}], vh, total}.
 */
export async function foldShots(page, dir, prefix, { maxFolds = 40, settle = 700, hideFixedAfterFirst = true } = {}) {
  const vh = page.viewportSize().height;
  const total = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const shots = [];
  let i = 0;
  for (let y = 0; y < total && i < maxFolds; y += vh, i++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(settle);
    if (i === 1 && hideFixedAfterFirst) await toggleFixed(page, false);
    const file = path.join(dir, `${prefix}-fold-${pad2(i + 1)}.png`);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 120000 });
    shots.push({ file, y, h: Math.min(vh, total - y) });
  }
  if (hideFixedAfterFirst && i > 1) await toggleFixed(page, true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  return { shots, vh, total };
}

/** Hide (show=false) or restore (show=true) fixed/sticky elements pinned near the top of the viewport. */
export async function toggleFixed(page, show) {
  try {
    await page.evaluate((show) => {
      if (show) {
        document.querySelectorAll('[data-copycat-hidden]').forEach((el) => { el.style.visibility = el.getAttribute('data-copycat-hidden') || ''; el.removeAttribute('data-copycat-hidden'); });
        return;
      }
      const vh = window.innerHeight;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.height > vh * 0.5) continue; // overlays/modals are not "bars"
        if (r.top > vh * 0.25 && r.bottom < vh * 0.75) continue; // floating widgets mid-screen: keep
        el.setAttribute('data-copycat-hidden', el.style.visibility || '');
        el.style.visibility = 'hidden';
      }
    }, show);
  } catch { }
}

/* ---------- PNG helpers (pngjs) ---------- */
let _PNG = null;
async function PNGmod() { if (!_PNG) _PNG = (await import('pngjs')).PNG; return _PNG; }

export async function readPng(file) { const PNG = await PNGmod(); return PNG.sync.read(fs.readFileSync(file)); }
export async function writePng(file, png) { const PNG = await PNGmod(); fs.writeFileSync(file, PNG.sync.write(png)); }

/** Stitch fold screenshots into one full-page PNG. The last fold is bottom-aligned (scroll clamps). */
export async function stitchFolds(shots, vh, total, outFile) {
  const PNG = await PNGmod();
  if (!shots.length) return null;
  const first = PNG.sync.read(fs.readFileSync(shots[0].file));
  const scale = first.height / vh; // deviceScaleFactor
  const W = first.width, H = Math.round(total * scale);
  const out = new PNG({ width: W, height: H });
  out.data.fill(255);
  for (let i = 0; i < shots.length; i++) {
    const png = i === 0 ? first : PNG.sync.read(fs.readFileSync(shots[i].file));
    const destY = Math.round(shots[i].y * scale);
    const rows = Math.min(png.height, H - destY);
    // if the scroll was clamped (last fold), the wanted rows are at the BOTTOM of the shot
    const srcStart = png.height - rows;
    for (let r = 0; r < rows; r++) {
      const src = (srcStart + r) * png.width * 4;
      png.data.copy(out.data, (destY + r) * W * 4, src, src + Math.min(png.width, W) * 4);
    }
  }
  fs.writeFileSync(outFile, PNG.sync.write(out));
  return { width: W, height: H };
}

/** Share of rows that are a single flat colour — high values mean reveal-on-scroll content was never shown. */
export async function blankRowRatio(file, { ignoreTopPx = 0 } = {}) {
  const png = await readPng(file);
  let blank = 0, counted = 0;
  for (let y = ignoreTopPx; y < png.height; y += 2) {
    counted++;
    const base = y * png.width * 4;
    const r0 = png.data[base], g0 = png.data[base + 1], b0 = png.data[base + 2];
    let flat = true;
    for (let x = 0; x < png.width; x += 3) {
      const i = base + x * 4;
      if (Math.abs(png.data[i] - r0) > 6 || Math.abs(png.data[i + 1] - g0) > 6 || Math.abs(png.data[i + 2] - b0) > 6) { flat = false; break; }
    }
    if (flat) blank++;
  }
  return counted ? blank / counted : 0;
}

/** Crop a region (CSS px, scaled by deviceScaleFactor) out of a PNG file. */
export async function cropPng(srcFile, outFile, { x, y, w, h }, scale = 1) {
  const PNG = await PNGmod();
  const png = await readPng(srcFile);
  const X = Math.max(0, Math.round(x * scale)), Y = Math.max(0, Math.round(y * scale));
  const W = Math.min(png.width - X, Math.round(w * scale)), H = Math.min(png.height - Y, Math.round(h * scale));
  if (W <= 0 || H <= 0) return null;
  const out = new PNG({ width: W, height: H });
  for (let r = 0; r < H; r++) {
    const src = ((Y + r) * png.width + X) * 4;
    png.data.copy(out.data, r * W * 4, src, src + W * 4);
  }
  fs.writeFileSync(outFile, PNG.sync.write(out));
  return { width: W, height: H };
}

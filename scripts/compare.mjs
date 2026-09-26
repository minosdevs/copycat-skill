#!/usr/bin/env node
/**
 * copycat compare — measure how close the clone is to the original capture.
 *
 *   node compare.mjs --original <capture-dir> --clone <url> [--viewports desktop,mobile]
 *                    [--out <capture-dir>/compare] [--threshold 0.1] [--wait 0] [--dark]
 *
 * For every viewport of the original capture:
 *   - loads the clone the same way (same viewport, scroll, fonts ready, animations frozen)
 *   - full-page screenshot + folds of the clone
 *   - pixel diff (pixelmatch) → mismatch %, per-band heatmap, worst zones mapped to sections
 *   - console errors / failed requests on the clone (must be 0)
 *   - fonts, palette, typography, sections diff vs the original manifest (desktop)
 * Writes compare/REPORT.md + compare/result.json and prints a JSON summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import {
  parseArgs, parseViewports, ensureDir, writeJson, readJson, pad2, log,
  runExtract, attachRecorders, autoScroll, robustGoto, newContext, fullPageShot, foldShots, stitchFolds,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const ORIG = path.resolve(args.original || args._[0] || '');
const CLONE = args.clone || args._[1];
if (!ORIG || !CLONE || !fs.existsSync(path.join(ORIG, 'manifest.json'))) {
  console.error('usage: node compare.mjs --original <capture-dir with manifest.json> --clone <url>');
  process.exit(1);
}
const cloneUrl = /^https?:\/\//i.test(CLONE) ? CLONE : 'http://' + CLONE;
const orig = readJson(path.join(ORIG, 'manifest.json'));
const OUT = ensureDir(path.resolve(args.out || path.join(ORIG, 'compare')));
const THRESHOLD = Number(args.threshold || 0.1);
const EXTRA_WAIT = Number(args.wait || 0);
const wanted = args.viewports ? Object.keys(parseViewports(args.viewports)) : Object.keys(orig.screens);
const rel = (p) => path.relative(OUT, p).split(path.sep).join('/');

const result = { tool: 'copycat compare', original: orig.url, clone: cloneUrl, comparedAt: new Date().toISOString(), viewports: {}, design: null, verdict: null };
const browser = await chromium.launch({ headless: !args.headed, channel: args.channel || undefined, args: args.channel ? ['--disable-blink-features=AutomationControlled'] : [] });
try {
  for (const name of wanted) {
    const vp = orig.options.viewports[name];
    if (!vp) { log(`viewport ${name} not in original capture, skipped`); continue; }
    log(`▶ ${name} ${vp.width}x${vp.height}`);
    const context = await newContext(browser, vp, { scale: orig.options.scale || 1, locale: orig.options.locale || 'en-US', colorScheme: args.dark ? 'dark' : (orig.options.colorScheme || 'light'), mobile: vp.width < 768 });
    const page = await context.newPage();
    const rec = attachRecorders(page);
    const vres = { viewport: vp, error: null };
    try {
      await robustGoto(page, cloneUrl, { timeout: 45000 });
      if (EXTRA_WAIT) await page.waitForTimeout(EXTRA_WAIT);
      await autoScroll(page);
      const dir = ensureDir(path.join(OUT, name));
      const cloneFull = path.join(OUT, `${name}-clone-full.png`);
      // use the SAME capture method as the original (native vs stitched) so the diff is fair
      const method = orig.screens[name]?.method || 'native';
      const { shots: folds, vh, total } = await foldShots(page, dir, 'clone');
      let ok;
      if (method === 'stitched') ok = !!(await stitchFolds(folds, vh, total, cloneFull));
      else ok = await fullPageShot(page, cloneFull);
      vres.method = method;
      vres.cloneFull = ok ? rel(cloneFull) : null;
      vres.cloneFolds = folds.map((f) => rel(f.file));
      vres.cloneScrollHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      vres.originalScrollHeight = orig.viewports[name]?.scrollHeight ?? null;
      vres.console = {
        errors: rec.console.filter((c) => c.type === 'error').map((c) => c.text.slice(0, 200)),
        warnings: rec.console.filter((c) => c.type === 'warning').length,
        pageErrors: rec.pageErrors,
        failedRequests: rec.failedRequests.map((f) => `${f.type} ${f.url} (${f.error})`),
        httpErrors: rec.responses.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url}`),
      };

      // pixel diff
      const origFull = orig.screens[name]?.full ? path.join(ORIG, orig.screens[name].full) : null;
      if (ok && origFull && fs.existsSync(origFull)) {
        vres.diff = diffImages(origFull, cloneFull, path.join(OUT, `${name}-diff.png`), path.join(OUT, `${name}-side-by-side.png`), THRESHOLD);
        vres.diff.diffFile = rel(path.join(OUT, `${name}-diff.png`));
        vres.diff.sideBySide = rel(path.join(OUT, `${name}-side-by-side.png`));
        // map worst bands to original sections
        const secs = orig.viewports[name]?.sections || [];
        vres.diff.worstZones = vres.diff.worstBands.map((b) => ({ ...b, sections: secs.filter((s) => s.rect.y < b.yEnd && s.rect.y + s.rect.h > b.yStart).map((s) => `#${s.index + 1} ${s.tag}${s.id ? '#' + s.id : ''}${s.heading ? ' "' + s.heading.slice(0, 40) + '"' : ''}`) }));
      } else vres.diff = { error: !origFull ? 'original has no full-page screenshot' : 'clone full-page screenshot failed' };

      // design diff (primary viewport only)
      if (orig.design && (name === 'desktop' || name === wanted[0]) && !result.design) {
        const d2 = await runExtract(page, {});
        result.design = diffDesign(orig.design, d2);
        result.design.cloneTitle = d2.meta.title;
      }
    } catch (e) {
      vres.error = String(e.message).split('\n')[0];
    }
    result.viewports[name] = vres;
    await context.close();
  }
} finally { await browser.close(); }

// verdict
const diffs = Object.values(result.viewports).filter((v) => v.diff && v.diff.mismatchPercent != null).map((v) => v.diff.mismatchPercent);
const consoleIssues = Object.values(result.viewports).reduce((s, v) => s + (v.console ? v.console.errors.length + v.console.pageErrors.length + v.console.failedRequests.length + v.console.httpErrors.length : 0), 0);
const worst = diffs.length ? Math.max(...diffs) : null;
result.verdict = {
  worstMismatchPercent: worst,
  consoleIssues,
  missingFonts: result.design?.fonts.missing.length ?? null,
  missingColors: result.design?.palette.missing.length ?? null,
  grade: worst == null ? 'n/a' : worst < 2 && consoleIssues === 0 ? 'A — pixel-close' : worst < 6 && consoleIssues === 0 ? 'B — very close, polish remaining' : worst < 15 ? 'C — structure right, details off' : 'D — significant differences',
};
writeJson(path.join(OUT, 'result.json'), result);
fs.writeFileSync(path.join(OUT, 'REPORT.md'), renderReport(result));
console.log(JSON.stringify({ out: OUT, report: path.join(OUT, 'REPORT.md'), ...result.verdict, perViewport: Object.fromEntries(Object.entries(result.viewports).map(([n, v]) => [n, v.diff?.mismatchPercent ?? v.error ?? v.diff?.error])) }, null, 2));

/* ------------------------------------------------------------------ */
function readPng(p) { return PNG.sync.read(fs.readFileSync(p)); }

function diffImages(aPath, bPath, diffOut, sideOut, threshold) {
  const a = readPng(aPath), b = readPng(bPath);
  const width = Math.min(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const A = fit(a, width, height), B = fit(b, width, height);
  const out = new PNG({ width, height });
  const changed = pixelmatch(A.data, B.data, out.data, width, height, { threshold, includeAA: false, alpha: 0.35, diffColor: [255, 0, 90], diffColorAlt: [0, 170, 255] });
  fs.writeFileSync(diffOut, PNG.sync.write(out));
  const overlap = Math.min(a.height, b.height);
  // per-band density (200px bands)
  const band = 200;
  const bands = [];
  for (let y0 = 0; y0 < height; y0 += band) {
    const y1 = Math.min(height, y0 + band);
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (out.data[i] === 255 && out.data[i + 1] === 0 && out.data[i + 2] === 90) n++; }
    bands.push({ yStart: y0, yEnd: y1, mismatchPercent: +(100 * n / ((y1 - y0) * width)).toFixed(2) });
  }
  // side-by-side (downscaled so each column ≤ 480px wide)
  const scale = Math.min(1, 480 / width);
  const sw = Math.round(width * scale), sh = Math.round(height * scale);
  const side = new PNG({ width: sw * 3 + 20, height: sh });
  side.data.fill(255);
  blitScaled(A, side, 0, scale, sw, sh); blitScaled(B, side, sw + 10, scale, sw, sh); blitScaled(out, side, sw * 2 + 20, scale, sw, sh);
  fs.writeFileSync(sideOut, PNG.sync.write(side));
  return {
    width, originalHeight: a.height, cloneHeight: b.height, heightDelta: b.height - a.height,
    mismatchPercent: +(100 * changed / (width * height)).toFixed(2),
    mismatchPercentOverlapOnly: +(100 * countDiffRows(out, width, overlap) / (width * overlap)).toFixed(2),
    bands,
    worstBands: [...bands].sort((x, y) => y.mismatchPercent - x.mismatchPercent).slice(0, 5).filter((x) => x.mismatchPercent > 0.5),
  };
}
function countDiffRows(png, width, rows) { let n = 0; for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (png.data[i] === 255 && png.data[i + 1] === 0 && png.data[i + 2] === 90) n++; } return n; }
function fit(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(255);
  for (let y = 0; y < Math.min(height, png.height); y++) png.data.copy(out.data, y * width * 4, y * png.width * 4, y * png.width * 4 + width * 4);
  return out;
}
function blitScaled(src, dst, dx, scale, sw, sh) {
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4, di = (y * dst.width + x + dx) * 4;
      dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255;
    }
  }
}

function hexToRgb(h) { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null; }
function colorDist(a, b) { const A = hexToRgb(a), B = hexToRgb(b); if (!A || !B) return 999; return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2); }

function diffDesign(o, c) {
  const oFam = o.fonts.familiesUsed.map((f) => f.value), cFam = c.fonts.familiesUsed.map((f) => f.value);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fonts = { original: oFam, clone: cFam, missing: oFam.filter((f) => !cFam.some((g) => norm(g) === norm(f))), extra: cFam.filter((f) => !oFam.some((g) => norm(g) === norm(f))) };
  const paletteCheck = (key, n) => {
    const oc = o.palette[key].slice(0, n).map((x) => x.value), cc = c.palette[key].map((x) => x.value);
    return { missing: oc.filter((h) => !cc.some((k) => colorDist(h, k) < 14)), extra: cc.slice(0, n).filter((h) => !oc.some((k) => colorDist(h, k) < 14)) };
  };
  const bg = paletteCheck('backgrounds', 10), tx = paletteCheck('text', 8);
  const palette = { missing: [...bg.missing.map((h) => 'bg ' + h), ...tx.missing.map((h) => 'text ' + h)], extra: [...bg.extra.map((h) => 'bg ' + h), ...tx.extra.map((h) => 'text ' + h)] };
  const typo = [];
  for (const tag of ['h1', 'h2', 'h3', 'p', 'a', 'button']) {
    const ot = (o.typography.byTag[tag] || [])[0], ct = (c.typography.byTag[tag] || [])[0];
    if (!ot) continue;
    if (!ct) { typo.push({ tag, issue: 'missing in clone', original: fmtTypo(ot) }); continue; }
    const issues = [];
    if (norm(ot.fontFamily) !== norm(ct.fontFamily)) issues.push(`family ${ot.fontFamily} → ${ct.fontFamily}`);
    if (Math.abs(parseFloat(ot.fontSize) - parseFloat(ct.fontSize)) > 1) issues.push(`size ${ot.fontSize} → ${ct.fontSize}`);
    if (ot.fontWeight !== ct.fontWeight) issues.push(`weight ${ot.fontWeight} → ${ct.fontWeight}`);
    if (Math.abs(parseFloat(ot.lineHeight) - parseFloat(ct.lineHeight)) > 1.5 && ot.lineHeight !== 'normal') issues.push(`line-height ${ot.lineHeight} → ${ct.lineHeight}`);
    if (ot.letterSpacing !== ct.letterSpacing) issues.push(`tracking ${ot.letterSpacing} → ${ct.letterSpacing}`);
    if (colorDist(ot.color, ct.color) > 14) issues.push(`color ${ot.color} → ${ct.color}`);
    if (issues.length) typo.push({ tag, issue: issues.join('; '), original: fmtTypo(ot), clone: fmtTypo(ct) });
  }
  const body = [];
  for (const k of ['background', 'color', 'fontSize', 'lineHeight']) if (norm(o.page.body[k]) !== norm(c.page.body[k])) body.push(`${k} ${o.page.body[k]} → ${c.page.body[k]}`);
  if (norm(o.page.body.fontFamily.split(',')[0]) !== norm(c.page.body.fontFamily.split(',')[0])) body.push(`fontFamily ${o.page.body.fontFamily.split(',')[0]} → ${c.page.body.fontFamily.split(',')[0]}`);
  const sections = { original: o.sections.length, clone: c.sections.length, originalHeight: o.page.scrollHeight, cloneHeight: c.page.scrollHeight, headings: { missing: o.sections.map((s) => s.heading).filter(Boolean).filter((h) => !c.sections.some((s) => norm(s.heading) === norm(h))) } };
  const nav = { original: o.nav.links.filter((l) => l.text).map((l) => l.text), clone: c.nav.links.filter((l) => l.text).map((l) => l.text), heightDelta: (c.nav.height ?? 0) - (o.nav.height ?? 0), positionMatch: o.nav.position === c.nav.position };
  const ctas = { missing: o.ctas.slice(0, 8).map((x) => x.text).filter((t) => t && !c.ctas.some((y) => norm(y.text) === norm(t))) };
  const text = { missingHeadings: o.textOutline.filter((l) => /^#{1,3} /.test(l)).filter((l) => !c.textOutline.some((m) => norm(m) === norm(l))).slice(0, 20), originalLines: o.textOutline.length, cloneLines: c.textOutline.length };
  const meta = [];
  for (const k of ['title', 'description', 'lang']) if ((o.meta[k] || '') !== (c.meta[k] || '')) meta.push(`${k}: "${o.meta[k] || ''}" → "${c.meta[k] || ''}"`);
  if (!c.meta.favicons.length && o.meta.favicons.length) meta.push('favicon missing');
  if (!c.meta.og.image && o.meta.og.image) meta.push('og:image missing');
  const motion = { originalAnimated: o.motion.animatedElements.length, cloneAnimated: c.motion.animatedElements.length, originalTransitions: o.motion.transitionCount, cloneTransitions: c.motion.transitionCount, originalSticky: o.layout.stickies.length, cloneSticky: c.layout.stickies.length };
  const images = { original: o.media.images.filter((i) => i.visible).length, clone: c.media.images.filter((i) => i.visible).length, brokenInClone: c.media.images.filter((i) => i.visible && i.naturalWidth === 0).map((i) => i.src).slice(0, 10) };
  return { fonts, palette, typography: typo, body, sections, nav, ctas, text, meta, motion, images, breakpoints: { original: o.layout.breakpoints.slice(0, 6).map((b) => b.value), clone: c.layout.breakpoints.slice(0, 6).map((b) => b.value) } };
}
function fmtTypo(t) { return `${t.fontFamily} ${t.fontSize}/${t.lineHeight} ${t.fontWeight} ${t.letterSpacing} ${t.color}`; }

function renderReport(r) {
  const L = [`# copycat compare — ${new URL(r.original).hostname} vs clone`, '', `- Original: ${r.original}`, `- Clone: ${r.clone}`, `- Compared: ${r.comparedAt}`, '', `## Verdict: **${r.verdict.grade}**`, '', `- Worst viewport mismatch: **${r.verdict.worstMismatchPercent ?? 'n/a'}%** of pixels`, `- Console/network issues on the clone: **${r.verdict.consoleIssues}** (target 0)`, `- Fonts missing: ${r.verdict.missingFonts ?? 'n/a'} · palette colours missing: ${r.verdict.missingColors ?? 'n/a'}`, ''];
  L.push('## Per viewport', '');
  for (const [n, v] of Object.entries(r.viewports)) {
    L.push(`### ${n} (${v.viewport.width}×${v.viewport.height})`, '');
    if (v.error) { L.push(`- ❌ ${v.error}`, ''); continue; }
    if (v.diff?.mismatchPercent != null) {
      L.push(`- Mismatch: **${v.diff.mismatchPercent}%** (overlapping area only: ${v.diff.mismatchPercentOverlapOnly}%) · height original ${v.diff.originalHeight}px vs clone ${v.diff.cloneHeight}px (${v.diff.heightDelta >= 0 ? '+' : ''}${v.diff.heightDelta}px)`);
      L.push(`- Side-by-side (original | clone | diff): \`${v.diff.sideBySide}\` · diff mask: \`${v.diff.diffFile}\` · clone folds: \`${n}/\``);
      if (v.diff.worstZones?.length) { L.push('- Worst zones (fix these first):'); for (const z of v.diff.worstZones) L.push(`  - y ${z.yStart}–${z.yEnd}px: ${z.mismatchPercent}% → ${z.sections.length ? z.sections.join(', ') : 'beyond original height / no section'}`); }
    } else L.push(`- Diff: ${v.diff?.error || 'n/a'}`);
    const c = v.console;
    L.push(`- Console: ${c.errors.length} errors, ${c.warnings} warnings, ${c.pageErrors.length} exceptions, ${c.failedRequests.length} failed requests, ${c.httpErrors.length} HTTP ≥ 400`);
    for (const e of c.errors.slice(0, 8)) L.push(`  - error: ${e}`);
    for (const e of c.pageErrors.slice(0, 5)) L.push(`  - exception: ${e.slice(0, 200)}`);
    for (const e of c.failedRequests.slice(0, 8)) L.push(`  - failed: ${e.slice(0, 200)}`);
    for (const e of c.httpErrors.slice(0, 8)) L.push(`  - ${e.slice(0, 200)}`);
    L.push('');
  }
  const d = r.design;
  if (d) {
    L.push('## Design diff (desktop)', '');
    L.push(`- Fonts — original: ${d.fonts.original.join(', ') || '—'} · clone: ${d.fonts.clone.join(', ') || '—'}${d.fonts.missing.length ? ` · **missing: ${d.fonts.missing.join(', ')}**` : ' · ✓'}`);
    L.push(`- Palette — ${d.palette.missing.length ? '**missing: ' + d.palette.missing.join(', ') + '**' : '✓ top colours all present'}${d.palette.extra.length ? ' · extra in clone: ' + d.palette.extra.join(', ') : ''}`);
    L.push(`- Body — ${d.body.length ? '**' + d.body.join('; ') + '**' : '✓'}`);
    if (d.typography.length) { L.push('- Typography:'); for (const t of d.typography) L.push(`  - **${t.tag}**: ${t.issue}${t.clone ? ` (orig ${t.original} · clone ${t.clone})` : ''}`); } else L.push('- Typography — ✓ h1/h2/h3/p/a/button match');
    L.push(`- Sections — original ${d.sections.original} (${d.sections.originalHeight}px) · clone ${d.sections.clone} (${d.sections.cloneHeight}px)${d.sections.headings.missing.length ? ` · **headings missing: ${d.sections.headings.missing.map((h) => '"' + h.slice(0, 40) + '"').join(', ')}**` : ''}`);
    L.push(`- Nav — ${d.nav.positionMatch ? '✓ position' : '**position differs**'} · height Δ ${d.nav.heightDelta}px · original links: ${d.nav.original.join(' · ')} · clone: ${d.nav.clone.join(' · ') || '—'}`);
    if (d.ctas.missing.length) L.push(`- CTAs missing: **${d.ctas.missing.join(', ')}**`);
    if (d.text.missingHeadings.length) L.push(`- Copy — headings not found in clone: ${d.text.missingHeadings.map((h) => '"' + h.replace(/^#+ /, '').slice(0, 50) + '"').join(', ')}`);
    L.push(`- Copy — ${d.text.originalLines} outline lines original vs ${d.text.cloneLines} clone`);
    if (d.meta.length) L.push(`- Meta — **${d.meta.join('; ')}**`); else L.push('- Meta — ✓ title/description/lang/favicon/og:image');
    L.push(`- Motion — animated ${d.motion.originalAnimated}→${d.motion.cloneAnimated} · transitions ${d.motion.originalTransitions}→${d.motion.cloneTransitions} · sticky/fixed ${d.motion.originalSticky}→${d.motion.cloneSticky}`);
    L.push(`- Images — visible ${d.images.original}→${d.images.clone}${d.images.brokenInClone.length ? ` · **broken in clone: ${d.images.brokenInClone.join(', ')}**` : ''}`);
    L.push(`- Breakpoints — original ${d.breakpoints.original.join(', ') || '—'} · clone ${d.breakpoints.clone.join(', ') || '—'}`);
  }
  L.push('', '## How to read this', '', '- < 2 % mismatch with a clean console is pixel-close. Anti-aliasing and image compression alone account for ~0.5–1.5 %.', '- Height delta ≠ 0 shifts everything below the first divergence, inflating the % — fix the topmost worst zone first, re-run.', '- Text rendering differs slightly between machines; judge fonts by the design diff (family/size/weight), not by pixels.');
  return L.join('\n') + '\n';
}

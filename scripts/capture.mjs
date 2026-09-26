#!/usr/bin/env node
/**
 * copycat capture — photograph and dissect a live site so it can be rebuilt 1:1.
 *
 *   node capture.mjs <url> [--out dir] [--viewports desktop,tablet,mobile | name:WxH,...]
 *                          [--scale 1|2] [--depth 0|1] [--max-pages 8] [--no-assets] [--no-css]
 *                          [--no-hover] [--headed] [--locale en-US] [--dark] [--timeout 45000]
 *                          [--wait 0] [--videos] [--channel chrome|msedge]  (real Chrome: passes most bot walls)
 *
 * Output (default ./copycat/<host>/):
 *   REPORT.md                 ← read this first
 *   manifest.json             ← everything, machine readable
 *   screens/<vp>-full.png     full-page screenshot per viewport
 *   screens/<vp>/…-fold-NN.png viewport-sized slices (easier to read than a 12 000px image)
 *   screens/sections/NN-*.png one crop per detected section (desktop)
 *   screens/hover/            before/after hover crops
 *   css/                      every stylesheet (external + inline)
 *   assets/{images,fonts,icons,svg,videos}/   downloaded media, mapped in manifest.assets
 *   content/page.html, text.md, dom-outline.txt
 *   pages/<slug>/             (--depth 1) other internal pages linked from the nav
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import {
  parseArgs, parseViewports, ensureDir, writeJson, slugify, pad2, fmtBytes, log,
  runExtract, attachRecorders, hideConsentOverlays, autoScroll, robustGoto, newContext, fullPageShot, foldShots,
  stitchFolds, blankRowRatio, cropPng,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) {
  console.error('usage: node capture.mjs <url> [--out dir] [--viewports desktop,tablet,mobile] [--depth 1] [--no-assets]');
  process.exit(1);
}
const url = /^https?:\/\//i.test(target) ? target : 'https://' + target;
const host = new URL(url).hostname.replace(/^www\./, '');
const OUT = path.resolve(args.out || path.join('copycat', host));
const VIEWPORTS = parseViewports(args.viewports);
const SCALE = Number(args.scale || 1);
const DEPTH = Number(args.depth || 0);
const MAX_PAGES = Number(args['max-pages'] || 8);
const WANT_ASSETS = args.assets !== false;
const WANT_CSS = args.css !== false;
const WANT_HOVER = args.hover !== false;
const WANT_VIDEOS = !!args.videos;
const TIMEOUT = Number(args.timeout || 45000);
const EXTRA_WAIT = Number(args.wait || 0);
const LOCALE = args.locale || 'en-US';
const COLOR_SCHEME = args.dark ? 'dark' : 'light';

const dirs = {
  screens: ensureDir(path.join(OUT, 'screens')),
  sections: ensureDir(path.join(OUT, 'screens', 'sections')),
  hover: ensureDir(path.join(OUT, 'screens', 'hover')),
  css: ensureDir(path.join(OUT, 'css')),
  content: ensureDir(path.join(OUT, 'content')),
  assets: ensureDir(path.join(OUT, 'assets')),
  pages: DEPTH >= 1 ? ensureDir(path.join(OUT, 'pages')) : path.join(OUT, 'pages'),
};

const manifest = {
  tool: 'copycat capture',
  version: '1.0.0',
  url,
  host,
  capturedAt: new Date().toISOString(),
  options: { viewports: VIEWPORTS, scale: SCALE, depth: DEPTH, assets: WANT_ASSETS, css: WANT_CSS, hover: WANT_HOVER, locale: LOCALE, colorScheme: COLOR_SCHEME },
  out: OUT,
  screens: {},
  viewports: {},
  design: null,
  hover: [],
  css: [],
  assets: [],
  pages: [],
  console: {},
  warnings: [],
};

const rel = (p) => path.relative(OUT, p).split(path.sep).join('/');

const browser = await chromium.launch({ headless: !args.headed, channel: args.channel || undefined, args: args.channel ? ['--disable-blink-features=AutomationControlled'] : [] });
const t0 = Date.now();

try {
  const names = Object.keys(VIEWPORTS);
  const primary = names.includes('desktop') ? 'desktop' : names[0];

  for (const name of [primary, ...names.filter((n) => n !== primary)]) {
    const vp = VIEWPORTS[name];
    log(`▶ ${name} ${vp.width}x${vp.height}`);
    const context = await newContext(browser, vp, { scale: SCALE, locale: LOCALE, colorScheme: COLOR_SCHEME, mobile: vp.width < 768 });
    const page = await context.newPage();
    const rec = attachRecorders(page);

    let loadedHow;
    try {
      loadedHow = await robustGoto(page, url, { timeout: TIMEOUT });
    } catch (e) {
      manifest.warnings.push(`${name}: navigation failed — ${String(e.message).split('\n')[0]}`);
      await context.close();
      continue;
    }
    if (EXTRA_WAIT) await page.waitForTimeout(EXTRA_WAIT);
    const finalUrl = page.url();
    const hiddenOverlays = await hideConsentOverlays(page);
    await autoScroll(page);
    await hideConsentOverlays(page);

    // ---- screenshots, part 1: folds taken while REALLY scrolled (reveal-on-scroll content shows),
    // stitched into a full-page image. Chromium's native full-page capture is taken LAST for this
    // viewport (see part 2): it resizes the viewport and leaves some pages with a broken layout.
    const foldDir = ensureDir(path.join(dirs.screens, name));
    const { shots: folds, vh, total } = await foldShots(page, foldDir, name);
    const scrollHeight = total;
    const stitchedFile = path.join(dirs.screens, `${name}-full-stitched.png`);
    let stitched = null;
    try { stitched = await stitchFolds(folds, vh, total, stitchedFile); } catch (e) { manifest.warnings.push(`${name}: stitch failed — ${e.message}`); }
    const fullFinal = path.join(dirs.screens, `${name}-full.png`);
    manifest.screens[name] = { full: null, method: null, native: null, stitched: stitched ? rel(stitchedFile) : null, blankRowRatio: {}, folds: folds.map((f) => ({ file: rel(f.file), y: f.y, h: f.h })), scrollHeight };

    // ---- extraction (full on primary, light on others)
    let data;
    try {
      data = await runExtract(page, {});
    } catch (e) {
      manifest.warnings.push(`${name}: extractor failed — ${String(e.message).split('\n')[0]}`);
    }
    manifest.viewports[name] = {
      viewport: vp,
      finalUrl,
      loadedHow,
      hiddenConsentOverlays: hiddenOverlays,
      scrollHeight,
      sections: data ? data.sections.map((s) => ({ index: s.index, tag: s.tag, id: s.id, selector: s.selector, rect: s.rect, heading: s.heading })) : [],
      nav: data ? { visibleLinks: data.nav.visibleLinks, hasBurger: data.nav.hasBurger, height: data.nav.height, position: data.nav.position } : null,
      body: data ? data.page.body : null,
      containers: data ? data.layout.containers : [],
    };
    manifest.console[name] = {
      requests: rec.requests,
      console: rec.console,
      pageErrors: rec.pageErrors,
      failedRequests: rec.failedRequests,
      httpErrors: rec.responses.filter((r) => r.status >= 400),
      thirdPartyHosts: Object.entries(rec.responses.reduce((m, r) => { try { const h = new URL(r.url).hostname; if (!h.endsWith(host)) m[h] = (m[h] || 0) + 1; } catch { } return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([h, n]) => ({ host: h, requests: n })),
      byType: rec.responses.reduce((m, r) => { m[r.type] = (m[r.type] || 0) + 1; return m; }, {}),
      totalBytes: rec.responses.reduce((s, r) => s + (r.size || 0), 0),
    };

    if (name === primary && data) {
      manifest.design = data;
      manifest.finalUrl = finalUrl;

      // ---- raw HTML + text + DOM outline
      fs.writeFileSync(path.join(dirs.content, 'page.html'), await page.content());
      fs.writeFileSync(path.join(dirs.content, 'text.md'), `# ${data.meta.title || host}\n\nSource: ${finalUrl}\n\n` + data.textOutline.join('\n') + '\n');
      fs.writeFileSync(path.join(dirs.content, 'dom-outline.txt'), data.domOutline.join('\n') + '\n');

      // ---- section crops (cut from the stitched image, so reveal-on-scroll content is present)
      for (const s of data.sections) {
        if (!stitched || s.rect.h < 40 || s.rect.w < 100) continue;
        const file = path.join(dirs.sections, `${pad2(s.index + 1)}-${s.tag}${s.id ? '-' + slugify(s.id) : ''}.png`);
        try {
          const r = await cropPng(stitchedFile, file, { x: Math.max(0, s.rect.x), y: s.rect.y, w: Math.min(s.rect.w, vp.width - Math.max(0, s.rect.x)), h: Math.min(s.rect.h, 8000) }, SCALE);
          if (r) s.screenshot = rel(file);
        } catch (e) {
          manifest.warnings.push(`section ${s.index} crop failed — ${String(e.message).split('\n')[0]}`);
        }
      }

      // ---- hover states
      if (WANT_HOVER) {
        const PROPS = ['color', 'backgroundColor', 'borderColor', 'boxShadow', 'transform', 'opacity', 'textDecorationLine', 'outline', 'filter', 'scale', 'translate'];
        for (const cand of data.hoverCandidates.slice(0, 20)) {
          try {
            const loc = page.locator(cand.selector).first();
            await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
            await page.mouse.move(0, 0);
            await page.waitForTimeout(150);
            const before = await loc.evaluate((el, props) => { const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs[p]; return o; }, PROPS);
            const box = await loc.boundingBox();
            await loc.hover({ timeout: 2000, force: true });
            await page.waitForTimeout(450);
            const after = await loc.evaluate((el, props) => { const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs[p]; return o; }, PROPS);
            const changed = {};
            for (const p of PROPS) if (before[p] !== after[p]) changed[p] = { before: before[p], after: after[p] };
            const entry = { ...cand, changed, cursor: await loc.evaluate((el) => getComputedStyle(el).cursor) };
            if (Object.keys(changed).length && box) {
              const clipBox = { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(box.width + 24, vp.width), height: Math.min(box.height + 24, vp.height) };
              const f = path.join(dirs.hover, `${pad2(manifest.hover.length + 1)}-${slugify(cand.text || cand.kind)}-hover.png`);
              await page.screenshot({ path: f, clip: clipBox, caret: 'hide' });
              entry.screenshot = rel(f);
            }
            manifest.hover.push(entry);
            await page.mouse.move(0, 0);
          } catch { /* element gone / not hoverable */ }
        }
      }

      // ---- stylesheets
      if (WANT_CSS) {
        let i = 0;
        for (const sh of data.tech.stylesheets) {
          if (!sh.href) continue;
          try {
            const res = await context.request.get(sh.href, { timeout: 20000 });
            if (!res.ok()) { manifest.css.push({ href: sh.href, error: 'HTTP ' + res.status() }); continue; }
            const body = await res.text();
            const nameCss = `${pad2(++i)}-${slugify(path.basename(new URL(sh.href).pathname).replace(/\.css$/, '') || 'style')}.css`;
            fs.writeFileSync(path.join(dirs.css, nameCss), body);
            manifest.css.push({ href: sh.href, file: rel(path.join(dirs.css, nameCss)), bytes: body.length, accessibleFromJs: sh.accessible });
          } catch (e) {
            manifest.css.push({ href: sh.href, error: String(e.message).split('\n')[0] });
          }
        }
        const inline = await page.evaluate(() => Array.from(document.querySelectorAll('style')).map((s, i) => `/* ---- <style> #${i + 1}${s.id ? ' id=' + s.id : ''}${s.getAttribute('data-href') ? ' data-href=' + s.getAttribute('data-href') : ''} ---- */\n` + s.textContent).join('\n\n'));
        if (inline.trim()) {
          fs.writeFileSync(path.join(dirs.css, '00-inline-style-tags.css'), inline);
          manifest.css.unshift({ href: null, file: rel(path.join(dirs.css, '00-inline-style-tags.css')), bytes: inline.length, inline: true });
        }
      }

      // ---- assets
      if (WANT_ASSETS) {
        const wanted = new Map(); // url -> kind
        const add = (u, kind) => { if (!u || /^(data|blob):/.test(u)) return; try { const abs = new URL(u, finalUrl).href; if (!wanted.has(abs)) wanted.set(abs, kind); } catch { } };
        for (const img of data.media.images) {
          add(img.src, 'images');
          for (const u of (img.srcsetUrls || []).slice(0, 1)) add(u, 'images'); // largest candidate only
        }
        for (const b of data.media.backgroundImages) add(b.url, 'images');
        for (const f of data.fonts.faces) {
          // url() inside a stylesheet is relative to THAT stylesheet, not to the page
          const base = f.sheet || finalUrl;
          const urls = [...String(f.src).matchAll(/url\((['"]?)(.*?)\1\)/g)].map((m) => { try { return new URL(m[2], base).href; } catch { return m[2]; } });
          const woff2 = urls.filter((u) => /\.woff2(\?|$)/.test(u) || /format\(['"]?woff2/.test(f.src));
          for (const u of (woff2.length ? woff2 : urls)) add(u, 'fonts');
        }
        for (const fi of data.meta.favicons) add(fi.href, 'icons');
        add(data.meta.og.image, 'images');
        add(data.meta.manifest, 'icons');
        if (data.nav.logo && data.nav.logo.src) add(data.nav.logo.src, 'images');
        for (const v of data.media.videos) { add(v.poster, 'images'); if (WANT_VIDEOS) add(v.src, 'videos'); }
        // fonts loaded from Google: resolve via the CSS we fetched (already covered by @font-face walk when accessible)
        for (const [u, kind] of wanted) {
          if (manifest.assets.length >= 300) { manifest.warnings.push('asset cap (300) reached'); break; }
          try {
            const res = await context.request.get(u, { timeout: 25000, maxRedirects: 5 });
            if (!res.ok()) { manifest.assets.push({ url: u, kind, error: 'HTTP ' + res.status() }); continue; }
            const buf = await res.body();
            if (buf.length > 25 * 1024 * 1024) { manifest.assets.push({ url: u, kind, error: 'skipped (>25MB)' }); continue; }
            const ct = (res.headers()['content-type'] || '').split(';')[0];
            const pu = new URL(u);
            // image proxies (Next.js /_next/image?url=…, Vercel/OG, Cloudinary-style) → name the file after the real source
            const inner = pu.searchParams.get('url') || pu.searchParams.get('src') || pu.searchParams.get('image');
            let base = (inner ? path.basename(new URL(inner, u).pathname) : path.basename(pu.pathname)) || 'file';
            base = decodeURIComponent(base).replace(/[^\w.\-]+/g, '_').slice(0, 80);
            const wParam = pu.searchParams.get('w');
            if (inner && wParam) base = base.replace(/(\.[^.]+)?$/, `-w${wParam}$1`);
            if (!path.extname(base)) {
              const ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/gif': '.gif', 'image/x-icon': '.ico', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'application/json': '.json', 'video/mp4': '.mp4', 'video/webm': '.webm' })[ct] || '';
              base += ext;
            }
            const hash = crypto.createHash('md5').update(u).digest('hex').slice(0, 6);
            const dir = ensureDir(path.join(dirs.assets, kind));
            let file = path.join(dir, base);
            if (fs.existsSync(file)) file = path.join(dir, base.replace(/(\.[^.]+)?$/, `-${hash}$1`));
            fs.writeFileSync(file, buf);
            manifest.assets.push({ url: u, kind, file: rel(file), bytes: buf.length, contentType: ct });
          } catch (e) {
            manifest.assets.push({ url: u, kind, error: String(e.message).split('\n')[0] });
          }
        }
        // inline SVGs (logos, icons)
        const svgDir = ensureDir(path.join(dirs.assets, 'svg'));
        data.media.inlineSvgs.forEach((s, i) => {
          if (!s.markup) return;
          const f = path.join(svgDir, `inline-${pad2(i + 1)}${s.inHeader ? '-header' : ''}${s.ariaLabel ? '-' + slugify(s.ariaLabel) : ''}.svg`);
          fs.writeFileSync(f, s.markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"').replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"(.*?)xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'xmlns="http://www.w3.org/2000/svg"$1'));
          s.file = rel(f);
          delete s.markup;
        });
        if (data.nav.logo && data.nav.logo.inlineSvg) {
          const f = path.join(svgDir, 'logo-header.svg');
          fs.writeFileSync(f, data.nav.logo.inlineSvg);
          data.nav.logo.file = rel(f);
          delete data.nav.logo.inlineSvg;
        }
      }

      // ---- depth 1: other internal pages from the nav
      if (DEPTH >= 1) {
        const seen = new Set([new URL(finalUrl).pathname.replace(/\/$/, '') || '/']);
        const candidates = data.links.internal.filter((l) => l.inNav || l.inFooter).concat(data.links.internal).filter((l) => { if (seen.has(l.path)) return false; seen.add(l.path); return true; }).slice(0, MAX_PAGES);
        for (const l of candidates) {
          const slug = slugify(l.path === '/' ? 'home' : l.path);
          const pdir = ensureDir(path.join(dirs.pages, slug));
          log(`  ↳ page ${l.path}`);
          const p2 = await context.newPage();
          const rec2 = attachRecorders(p2);
          const entry = { path: l.path, url: l.url, text: l.text, dir: rel(pdir) };
          try {
            await robustGoto(p2, l.url, { timeout: TIMEOUT });
            await hideConsentOverlays(p2);
            await autoScroll(p2, { maxSteps: 60 });
            const fd = ensureDir(path.join(pdir, 'folds'));
            const { shots: sh2, vh: vh2, total: tot2 } = await foldShots(p2, fd, primary, { maxFolds: 25 });
            const st2 = path.join(pdir, `${primary}-full-stitched.png`);
            let stitched2 = null;
            try { stitched2 = await stitchFolds(sh2, vh2, tot2, st2); } catch { }
            const nativeFile = path.join(pdir, `${primary}-full-native.png`);
            const ok = await fullPageShot(p2, nativeFile); // last: may break the page layout
            const bn = ok ? await blankRowRatio(nativeFile) : null, bs = stitched2 ? await blankRowRatio(st2) : null;
            const useSt = stitched2 && (!ok || (bn != null && bs != null && bn > bs + 0.08));
            const finalFile = path.join(pdir, `${primary}-full.png`);
            if (ok || stitched2) fs.copyFileSync(useSt ? st2 : nativeFile, finalFile);
            entry.full = (ok || stitched2) ? rel(finalFile) : null;
            entry.method = useSt ? 'stitched' : 'native';
            const d2 = await runExtract(p2, { maxElements: 4000 });
            fs.writeFileSync(path.join(pdir, 'text.md'), `# ${d2.meta.title}\n\nSource: ${p2.url()}\n\n` + d2.textOutline.join('\n') + '\n');
            fs.writeFileSync(path.join(pdir, 'page.html'), await p2.content());
            entry.title = d2.meta.title;
            entry.sections = d2.sections.map((s) => ({ tag: s.tag, id: s.id, heading: s.heading, rect: s.rect }));
            entry.consoleErrors = rec2.console.filter((c) => c.type === 'error').length + rec2.pageErrors.length;
            entry.scrollHeight = d2.page.scrollHeight;
          } catch (e) {
            entry.error = String(e.message).split('\n')[0];
          }
          manifest.pages.push(entry);
          await p2.close();
        }
      }
    }

    // ---- screenshots, part 2: native full-page capture, taken last (side effects no longer matter)
    const fullFile = path.join(dirs.screens, `${name}-full-native.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const fullOk = await fullPageShot(page, fullFile);
    let blankNative = null, blankStitched = null;
    if (fullOk) blankNative = await blankRowRatio(fullFile);
    if (stitched) blankStitched = await blankRowRatio(stitchedFile);
    // expose the image that shows the most content as <vp>-full.png
    const useStitched = stitched && (!fullOk || (blankNative != null && blankStitched != null && blankNative > blankStitched + 0.08));
    if (fullOk || stitched) fs.copyFileSync(useStitched ? stitchedFile : fullFile, fullFinal);
    if (useStitched && fullOk) manifest.warnings.push(`${name}: native full-page had ${(blankNative * 100).toFixed(0)}% flat rows vs ${(blankStitched * 100).toFixed(0)}% stitched (reveal-on-scroll?) — ${name}-full.png is the stitched version`);
    Object.assign(manifest.screens[name], { full: (fullOk || stitched) ? rel(fullFinal) : null, method: useStitched ? 'stitched' : 'native', native: fullOk ? rel(fullFile) : null, blankRowRatio: { native: blankNative, stitched: blankStitched } });

    await context.close();
  }
} finally {
  await browser.close();
}

manifest.durationMs = Date.now() - t0;
writeJson(path.join(OUT, 'manifest.json'), manifest);
fs.writeFileSync(path.join(OUT, 'REPORT.md'), renderReport(manifest));
log(`done in ${(manifest.durationMs / 1000).toFixed(1)}s → ${OUT}`);
console.log(JSON.stringify({ out: OUT, report: path.join(OUT, 'REPORT.md'), manifest: path.join(OUT, 'manifest.json'), viewports: Object.keys(manifest.screens), sections: manifest.design?.sections.length ?? 0, assets: manifest.assets.filter((a) => a.file).length, warnings: manifest.warnings.length }, null, 2));

/* ------------------------------------------------------------------ */
function renderReport(m) {
  const d = m.design;
  const L = [];
  const h = (t) => L.push('', `## ${t}`, '');
  const table = (head, rows) => { L.push('| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |'); for (const r of rows) L.push('| ' + r.map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |'); };
  L.push(`# copycat capture — ${m.host}`, '', `- URL: ${m.url}${m.finalUrl && m.finalUrl !== m.url ? ` → ${m.finalUrl}` : ''}`, `- Captured: ${m.capturedAt} (${(m.durationMs / 1000).toFixed(1)}s)`, `- Output: \`${m.out}\``, `- Viewports: ${Object.entries(m.options.viewports).map(([n, v]) => `${n} ${v.width}×${v.height}`).join(', ')} @${m.options.scale}x, ${m.options.colorScheme}`);
  if (!d) { L.push('', '**Extraction failed on every viewport — see warnings.**', '', ...m.warnings.map((w) => '- ' + w)); return L.join('\n'); }

  h('TL;DR for the rebuild');
  L.push(`- Title: **${d.meta.title || '—'}** · lang=${d.meta.lang || '?'} · ${d.page.scrollHeight}px tall on desktop, ${d.sections.length} sections`);
  L.push(`- Stack detected: ${d.tech.detected.length ? d.tech.detected.join(', ') : 'nothing obvious (hand-written?)'}`);
  L.push(`- Body: bg ${d.page.body.background} · text ${d.page.body.color} · ${d.page.body.fontFamily.split(',')[0]} ${d.page.body.fontSize}/${d.page.body.lineHeight} · root font-size ${d.page.rootFontSize}`);
  L.push(`- Fonts actually used: ${d.fonts.familiesUsed.map((f) => `**${f.value}**`).join(', ') || '—'}`);
  L.push(`- Containers: ${d.layout.containers.slice(0, 3).map((c) => c.value).join(' · ') || '—'} · breakpoints: ${d.layout.breakpoints.slice(0, 6).map((b) => b.value).join(', ') || '—'}`);
  L.push(`- Header: ${d.nav.position || '—'} ${d.nav.height ? d.nav.height + 'px' : ''} bg ${d.nav.background || 'transparent'}${d.nav.backdropFilter ? ' backdrop ' + d.nav.backdropFilter : ''} · ${d.nav.visibleLinks} nav links${d.nav.hasBurger ? ' · burger menu' : ''}`);
  L.push(`- Motion: ${d.motion.animatedElements.length} animated elements, ${d.motion.keyframes.length} keyframes, ${d.motion.transitionCount} elements with transitions, ${d.layout.stickies.length} sticky/fixed`);
  L.push(`- Dark mode: ${d.page.darkModeMedia || d.page.hasDarkClassToggle ? 'yes (' + (d.page.darkModeMedia ? 'media query' : '') + (d.page.hasDarkClassToggle ? ' class/attr toggle' : '') + ')' : 'no'} · color-scheme ${d.page.colorScheme} · reduced-motion handled: ${d.page.reducedMotionMedia ? 'yes' : 'no'}`);
  const errs = Object.entries(m.console).map(([n, c]) => `${n}: ${c.console.filter((x) => x.type === 'error').length + c.pageErrors.length} errors, ${c.failedRequests.length} failed req, ${c.httpErrors.length} HTTP≥400`).join(' · ');
  L.push(`- Console on the original: ${errs}`);
  if (m.warnings.length) L.push(`- ⚠ ${m.warnings.length} warnings (see bottom)`);

  h('Screenshots');
  for (const [n, s] of Object.entries(m.screens)) L.push(`- **${n}** (${m.viewports[n]?.scrollHeight}px): \`${s.full}\` (${s.method}${s.method === 'stitched' ? ' — native capture was blank where content reveals on scroll' : ''}) · ${s.folds.length} folds in \`screens/${n}/\` (fold 1 shows the fixed header, later folds hide it)`);
  L.push('- Folds are the most reliable view: each is a real viewport at a real scroll position. Read them one by one while rebuilding.');
  L.push(`- Sections (desktop crops): \`screens/sections/\` · hover states: \`screens/hover/\` (${m.hover.filter((x) => x.screenshot).length})`);
  if (m.pages.length) L.push(`- Other pages: ${m.pages.map((p) => `\`${p.dir}\` (${p.path})`).join(', ')}`);

  h('Fonts');
  table(['family', 'weights loaded', 'source'], (() => {
    const fam = {};
    for (const f of d.fonts.loaded) { fam[f.family] = fam[f.family] || new Set(); fam[f.family].add(f.weight + (f.style !== 'normal' ? ' ' + f.style : '')); }
    for (const f of d.fonts.faces) { fam[f.family] = fam[f.family] || new Set(); fam[f.family].add(f.weight + (f.style !== 'normal' ? ' ' + f.style : '')); }
    return Object.entries(fam).map(([name, w]) => {
      const faces = d.fonts.faces.filter((x) => x.family === name);
      const src = faces.length ? (faces[0].src.match(/url\((['"]?)(.*?)\1\)/) || [])[2] || faces[0].src : (d.fonts.externalLinks.length ? 'external link (see below)' : 'system / not self-hosted');
      const local = m.assets.filter((a) => a.kind === 'fonts' && a.file && faces.some((f) => f.src.includes(path.basename(new URL(a.url).pathname))));
      return [name, [...w].sort().join(', '), `${String(src).slice(0, 90)}${local.length ? ' → ' + local.map((a) => '`' + a.file + '`').join(', ') : ''}`];
    });
  })());
  if (d.fonts.externalLinks.length) L.push('', 'External font links:', ...d.fonts.externalLinks.map((u) => '- ' + u));
  L.push('', 'Usage (weighted by characters): ' + d.fonts.familiesUsed.map((f) => `${f.value} (${f.weight})`).join(', '));

  h('Colour palette (computed, weighted)');
  L.push('Backgrounds (by area): ' + d.palette.backgrounds.slice(0, 14).map((c) => `\`${c.value}\``).join(' '));
  L.push('', 'Text (by chars): ' + d.palette.text.slice(0, 12).map((c) => `\`${c.value}\``).join(' '));
  L.push('', 'Borders: ' + (d.palette.borders.slice(0, 10).map((c) => `\`${c.value}\``).join(' ') || '—'));
  if (d.palette.gradients.length) L.push('', 'Gradients:', ...d.palette.gradients.slice(0, 6).map((g) => '- `' + g.value + '`'));
  if (d.meta.themeColor) L.push('', `theme-color: \`${d.meta.themeColor}\``);

  const vars = Object.entries(d.cssVars);
  if (vars.length) {
    h(`CSS custom properties on :root (${vars.length})`);
    L.push('```css', ':root {', ...vars.slice(0, 120).map(([k, v]) => `  ${k}: ${v.declared};${v.computed && v.computed !== v.declared ? ` /* = ${v.computed} */` : ''}`), vars.length > 120 ? `  /* … ${vars.length - 120} more in manifest.json → design.cssVars */` : '', '}', '```');
  }

  h('Typography (computed, most frequent per tag)');
  const TAG_ORDER = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'li', 'span', 'label', 'small', 'blockquote', 'div'];
  const tagRank = (t) => { const i = TAG_ORDER.indexOf(t); return i < 0 ? 99 : i; };
  table(['tag', 'family', 'size', 'weight', 'line-height', 'tracking', 'transform', 'color', 'n', 'sample'], Object.entries(d.typography.byTag).sort((a, b) => tagRank(a[0]) - tagRank(b[0])).flatMap(([tag, arr]) => arr.slice(0, 3).map((t) => [tag, t.fontFamily, t.fontSize, t.fontWeight, t.lineHeight, t.letterSpacing, t.textTransform === 'none' ? '' : t.textTransform, t.color, t.count, t.sample])));

  h('Layout system');
  L.push('- Containers (max-width + padding-x): ' + (d.layout.containers.map((c) => `${c.value} ×${c.weight}`).join(' · ') || '—'));
  L.push('- Breakpoints in CSS: ' + (d.layout.breakpoints.map((b) => `${b.value} ×${b.weight}`).join(', ') || '—'));
  L.push('- Spacing scale (most used paddings/margins/gaps): ' + d.layout.spacingScale.slice(0, 18).map((s) => s.value).join(', '));
  L.push('- Border radii: ' + (d.layout.radii.slice(0, 8).map((s) => s.value).join(', ') || '—'));
  if (d.layout.shadows.length) L.push('- Shadows:', ...d.layout.shadows.slice(0, 5).map((s) => '  - `' + s.value + '`'));
  if (d.layout.stickies.length) { L.push('- Sticky / fixed elements:'); for (const s of d.layout.stickies.slice(0, 10)) L.push(`  - \`${s.selector}\` ${s.position} top:${s.top} z:${s.zIndex} ${s.rect.w}×${s.rect.h}${s.backdropFilter ? ' backdrop:' + s.backdropFilter : ''} ${s.text ? '"' + s.text + '"' : ''}`); }
  for (const [n, v] of Object.entries(m.viewports)) if (n !== 'desktop' && v.nav) L.push(`- ${n}: ${v.scrollHeight}px tall · nav links visible ${v.nav.visibleLinks}${v.nav.hasBurger ? ' + burger' : ''} · ${v.sections.length} sections`);

  h(`Sections (desktop, top → bottom) — ${d.sections.length}`);
  table(['#', 'element', 'y', 'h', 'bg', 'heading', 'media', 'CTAs', 'crop'], d.sections.map((s) => [s.index + 1, `${s.tag}${s.id ? '#' + s.id : ''}${s.classes ? ' .' + s.classes.split(/\s+/).slice(0, 2).join('.') : ''}`, s.rect.y, s.rect.h, s.background || '', s.heading || (s.textPreview ? s.textPreview.slice(0, 50) : ''), s.mediaCount, s.ctas.join(' / '), s.screenshot ? '`' + s.screenshot + '`' : '']));

  h('Header / navigation');
  L.push(`- \`${d.nav.selector}\` · ${d.nav.position} · ${d.nav.height}px · bg ${d.nav.background || 'transparent'}${d.nav.backdropFilter ? ' · backdrop-filter ' + d.nav.backdropFilter : ''}`);
  if (d.nav.logo) L.push(`- Logo: ${d.nav.logo.tag} ${d.nav.logo.w}×${d.nav.logo.h}${d.nav.logo.file ? ' → `' + d.nav.logo.file + '`' : d.nav.logo.src ? ' ' + d.nav.logo.src : ''}`);
  L.push('- Links: ' + d.nav.links.filter((l) => l.text).map((l) => `${l.text}${l.visible ? '' : ' (hidden)'} → ${l.href.replace(/^https?:\/\/[^/]+/, '') || '/'}`).join(' · '));
  if (d.footerLinks.length) L.push(`- Footer: ${d.footerLinks.length} links — ` + d.footerLinks.slice(0, 25).map((l) => l.text).filter(Boolean).join(' · '));

  h('Buttons / CTAs (computed styles)');
  table(['text', 'bg', 'color', 'border', 'radius', 'padding', 'font', 'shadow', 'n'], d.ctas.slice(0, 12).map((c) => [c.text, c.style.background || 'transparent', c.style.color, c.style.border, c.style.borderRadius, c.style.padding, `${c.style.fontFamily} ${c.style.fontSize}/${c.style.fontWeight}`, c.style.boxShadow || '', c.count]));

  if (m.hover.length) {
    h('Hover states');
    for (const hv of m.hover) {
      const ch = Object.entries(hv.changed);
      L.push(`- ${hv.kind} "${hv.text}" (\`${hv.selector}\`, cursor ${hv.cursor}): ${ch.length ? ch.map(([p, v]) => `${p} ${v.before} → ${v.after}`).join('; ') : 'no computed change (maybe JS/child-only)'}${hv.screenshot ? ' · `' + hv.screenshot + '`' : ''}`);
    }
  }

  h('Motion');
  if (d.motion.keyframes.length) L.push('- @keyframes: ' + d.motion.keyframes.slice(0, 30).join(', '));
  if (d.motion.animatedElements.length) { L.push('- Animated elements (sample):'); for (const a of d.motion.animatedElements.slice(0, 12)) L.push(`  - \`${a.selector}\` ${a.name} ${a.duration} ${a.timing} ×${a.iteration}${a.delay !== '0s' ? ' delay ' + a.delay : ''}`); }
  L.push(`- Transitions: ${d.motion.transitionCount} elements · top: ` + d.motion.transitionsTop.slice(0, 6).map((t) => '`' + t.value + '`').join(', '));
  L.push(`- Elements with transform: ${d.motion.transformCount} · scroll-behavior ${d.page.scrollBehavior} · scroll-snap ${d.page.scrollSnap ? 'yes' : 'no'} · custom cursor ${d.page.customCursor ? 'yes' : 'no'}`);
  L.push(`- Canvas: ${d.media.canvases} · Lottie: ${d.media.lottie} · videos: ${d.media.videos.length} · iframes: ${d.media.iframes.length}`);

  h('Media');
  const imgs = d.media.images;
  L.push(`- ${imgs.length} <img> (${imgs.filter((i) => i.visible).length} visible, ${imgs.filter((i) => i.loading === 'lazy').length} lazy) · ${d.media.backgroundImages.length} CSS background images · ${d.media.inlineSvgs.length} inline SVG`);
  L.push(`- Downloaded: ${m.assets.filter((a) => a.file).length} files (${fmtBytes(m.assets.reduce((s, a) => s + (a.bytes || 0), 0))}) → \`assets/\` · ${m.assets.filter((a) => a.error).length} failed`);
  table(['img', 'rendered', 'natural', 'fit', 'alt', 'local'], imgs.filter((i) => i.visible).slice(0, 30).map((i) => [i.src.split('/').pop().slice(0, 40), `${i.renderedWidth}×${i.renderedHeight}`, `${i.naturalWidth}×${i.naturalHeight}`, i.objectFit, (i.alt || '').slice(0, 30), (m.assets.find((a) => a.url === i.src) || {}).file || '']));
  for (const v of d.media.videos) L.push(`- video ${v.w}×${v.h} ${v.autoplay ? 'autoplay ' : ''}${v.loop ? 'loop ' : ''}${v.muted ? 'muted ' : ''}src=${v.src} poster=${v.poster || '—'}`);
  for (const f of d.media.iframes) L.push(`- iframe ${f.w}×${f.h} ${f.src}`);

  if (d.forms.length || d.standaloneInputs.length) {
    h('Forms');
    for (const f of d.forms) L.push(`- \`${f.selector}\` ${f.method || ''} ${f.action || ''} → fields: ${f.fields.map((x) => `${x.type || x.tag}${x.name ? ':' + x.name : ''}${x.placeholder ? ' "' + x.placeholder + '"' : ''}${x.required ? '*' : ''}`).join(', ')} · submit "${f.submit || ''}"`);
    for (const i of d.standaloneInputs) L.push(`- input ${i.type} "${i.placeholder || ''}" (\`${i.selector}\`, no <form>)`);
  }

  h('Tech, scripts, third parties');
  L.push('- Detected: ' + (d.tech.detected.join(', ') || '—'));
  L.push('- Analytics / widgets: ' + (d.tech.analytics.join(', ') || '—'));
  L.push(`- ${d.tech.scripts.length} external scripts, ${d.tech.stylesheets.length} stylesheets (${d.tech.stylesheets.filter((s) => !s.accessible).length} cross-origin/unreadable from JS → fetched to \`css/\` instead), ${d.tech.inlineStyleTags} inline <style>`);
  L.push(`- Stylesheets saved: ${m.css.filter((c) => c.file).map((c) => '`' + c.file + '` (' + fmtBytes(c.bytes) + ')').join(', ') || '—'}`);
  const c0 = m.console[Object.keys(m.console)[0]];
  if (c0) L.push(`- Network (desktop): ${c0.requests} requests, ~${fmtBytes(c0.totalBytes)} declared · by type ${Object.entries(c0.byType).map(([k, v]) => k + ':' + v).join(' ')}`, '- Third-party hosts: ' + c0.thirdPartyHosts.slice(0, 15).map((t) => `${t.host} (${t.requests})`).join(', '));
  if (d.meta.jsonLd.length) L.push(`- JSON-LD blocks: ${d.meta.jsonLd.length} (see manifest → design.meta.jsonLd)`);

  h('Console & network health of the ORIGINAL');
  for (const [n, c] of Object.entries(m.console)) {
    const errs = c.console.filter((x) => x.type === 'error');
    const warns = c.console.filter((x) => x.type === 'warning');
    L.push(`- **${n}**: ${errs.length} console errors, ${warns.length} warnings, ${c.pageErrors.length} uncaught exceptions, ${c.failedRequests.length} failed requests, ${c.httpErrors.length} HTTP ≥ 400`);
    for (const e of errs.slice(0, 6)) L.push(`  - error: ${e.text.slice(0, 160)}`);
    for (const e of c.pageErrors.slice(0, 4)) L.push(`  - exception: ${e.slice(0, 160)}`);
    for (const f of c.failedRequests.slice(0, 6)) L.push(`  - failed: ${f.type} ${f.url.slice(0, 120)} (${f.error})`);
    for (const f of c.httpErrors.slice(0, 6)) L.push(`  - HTTP ${f.status}: ${f.url.slice(0, 120)}`);
  }
  L.push('', '(These are the baseline. The clone must not add new ones; console must be clean on the clone.)');

  h('Meta / SEO to replicate');
  L.push(`- title: ${d.meta.title}`, `- description: ${d.meta.description || '—'}`, `- og:image: ${d.meta.og.image || '—'}`, `- canonical: ${d.meta.canonical || '—'}`, `- favicons: ${d.meta.favicons.map((f) => f.href.split('/').pop() + (f.sizes ? ' ' + f.sizes : '')).join(', ') || '—'}`, `- viewport: ${d.meta.viewport || '—'}`);

  h('Files');
  L.push('- `manifest.json` — full structured data (design.*, console.*, assets, css, hover, pages)', '- `content/text.md` — all copy in reading order, headings as markdown, CTAs tagged', '- `content/dom-outline.txt` — DOM tree with sizes + flex/grid hints (depth 7)', '- `content/page.html` — rendered DOM after scroll (post-hydration)', '- `css/` — every stylesheet as served', '- `assets/` — images, fonts, icons, inline SVGs' + (WANT_VIDEOS ? ', videos' : ' (videos skipped, use --videos)'));
  if (m.warnings.length) { h('Warnings'); for (const w of m.warnings) L.push('- ' + w); }
  return L.join('\n') + '\n';
}

/*
 * copycat — in-page design extractor.
 *
 * Runs INSIDE the target page (injected by capture.mjs / compare.mjs, or pasted by hand in
 * the DevTools console). Exposes `window.__copycatExtract(opts)` which returns a plain
 * JSON-serialisable object describing everything needed to rebuild the page:
 * meta, fonts, CSS variables, colour palette, typography, layout, sections, images,
 * links, scripts/frameworks, animations, forms, text outline and a DOM outline.
 *
 * Manual use in DevTools (any browser):
 *   1. paste this whole file in the console and press Enter
 *   2. copy(JSON.stringify(__copycatExtract(), null, 2))   → clipboard
 */
(function () {
  function __copycatExtract(opts) {
    opts = opts || {};
    var MAX_ELEMENTS = opts.maxElements || 8000;
    var doc = document;
    var win = window;
    var vw = win.innerWidth;
    var vh = win.innerHeight;

    /* ---------- helpers ---------- */
    function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
    function q(s) { return doc.querySelector(s); }
    function qa(s, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(s)); }
    function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }
    function clip(s, n) { s = s || ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
    function inc(map, key, w) { if (!key) return; map[key] = (map[key] || 0) + (w == null ? 1 : w); }
    function top(map, n, min) {
      return Object.keys(map)
        .map(function (k) { return { value: k, weight: Math.round(map[k]) }; })
        .filter(function (e) { return e.weight >= (min || 0); })
        .sort(function (a, b) { return b.weight - a.weight; })
        .slice(0, n);
    }
    function parseColor(c) {
      if (!c) return null;
      var m = c.match(/rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)\s*(?:[,/]\s*([\d.%]+))?\s*\)/);
      if (!m) return null;
      var a = m[4] == null ? 1 : (m[4].indexOf('%') >= 0 ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: +m[1], g: +m[2], b: +m[3], a: a };
    }
    function toHex(c) {
      var p = parseColor(c);
      if (!p) return c;
      if (p.a === 0) return null;
      var h = '#' + [p.r, p.g, p.b].map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
      return p.a < 1 ? h + ' @' + Math.round(p.a * 100) + '%' : h;
    }
    function firstFamily(ff) {
      if (!ff) return null;
      return ff.split(',')[0].replace(/["']/g, '').trim();
    }
    function cssEsc(s) { return (win.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1'); }
    function selectorFor(el) {
      if (!el || el === doc.body) return 'body';
      if (el.id && qa('#' + cssEsc(el.id)).length === 1) return '#' + cssEsc(el.id);
      var parts = [];
      var cur = el;
      var depth = 0;
      while (cur && cur !== doc.body && depth < 6) {
        var tag = cur.tagName.toLowerCase();
        if (cur.id && qa('#' + cssEsc(cur.id)).length === 1) { parts.unshift('#' + cssEsc(cur.id)); break; }
        var parent = cur.parentElement;
        var idx = 1;
        if (parent) {
          var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
          if (sibs.length > 1) idx = sibs.indexOf(cur) + 1, tag += ':nth-of-type(' + idx + ')';
        }
        parts.unshift(tag);
        cur = parent;
        depth++;
      }
      if (cur === doc.body || !cur) parts.unshift('body');
      return parts.join(' > ');
    }
    function isVisible(el, cs) {
      cs = cs || getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || num(cs.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function directText(el) {
      var s = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3) s += n.nodeValue;
      }
      return s.replace(/\s+/g, ' ').trim();
    }
    function classList(el, n) {
      var c = (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')).trim();
      return clip(c, n || 120);
    }

    /* ---------- meta ---------- */
    function metaContent(n) {
      var a = q('meta[name="' + n + '"]') || q('meta[property="' + n + '"]');
      return a ? a.content : null;
    }
    var meta = {
      url: location.href,
      title: doc.title,
      lang: doc.documentElement.lang || null,
      description: metaContent('description'),
      viewport: metaContent('viewport'),
      themeColor: metaContent('theme-color'),
      og: {
        title: metaContent('og:title'),
        description: metaContent('og:description'),
        image: metaContent('og:image') ? abs(metaContent('og:image')) : null,
        type: metaContent('og:type'),
        siteName: metaContent('og:site_name')
      },
      twitterCard: metaContent('twitter:card'),
      canonical: q('link[rel="canonical"]') ? q('link[rel="canonical"]').href : null,
      favicons: qa('link[rel*="icon"]').map(function (l) { return { rel: l.rel, href: l.href, sizes: l.getAttribute('sizes'), type: l.type }; }),
      manifest: q('link[rel="manifest"]') ? q('link[rel="manifest"]').href : null,
      generator: metaContent('generator'),
      jsonLd: qa('script[type="application/ld+json"]').map(function (s) { return clip(s.textContent, 4000); })
    };

    /* ---------- stylesheets: @font-face, :root vars, breakpoints, keyframes ---------- */
    var sheets = [];
    var fontFaces = [];
    var cssVarsDeclared = {};
    var breakpoints = {};
    var keyframes = [];
    var mediaQueries = {};
    var inlineStyleCount = qa('style').length;

    function walkRules(rules, sheetHref) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        try {
          if (r.type === CSSRule.FONT_FACE_RULE) {
            fontFaces.push({
              family: (r.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(),
              weight: r.style.getPropertyValue('font-weight') || 'normal',
              style: r.style.getPropertyValue('font-style') || 'normal',
              display: r.style.getPropertyValue('font-display') || null,
              src: r.style.getPropertyValue('src'),
              unicodeRange: r.style.getPropertyValue('unicode-range') || null,
              sheet: sheetHref
            });
          } else if (r.type === CSSRule.MEDIA_RULE) {
            var m = r.media.mediaText;
            inc(mediaQueries, m);
            var re = /\((?:min|max)-width:\s*([\d.]+)(px|em|rem)\)/g, mm;
            while ((mm = re.exec(m))) inc(breakpoints, mm[0]);
            // range syntax: (width >= 768px)
            var re2 = /\(width\s*(>=|<=|<|>)\s*([\d.]+)(px|em|rem)\)/g;
            while ((mm = re2.exec(m))) inc(breakpoints, mm[0]);
            walkRules(r.cssRules, sheetHref);
          } else if (r.type === CSSRule.KEYFRAMES_RULE) {
            if (keyframes.indexOf(r.name) < 0) keyframes.push(r.name);
          } else if (r.type === CSSRule.STYLE_RULE) {
            var sel = r.selectorText || '';
            if (/(^|,)\s*(:root|html|body|:host)\b/.test(sel)) {
              for (var p = 0; p < r.style.length; p++) {
                var prop = r.style[p];
                if (prop.indexOf('--') === 0 && !/^--tw-/.test(prop)) {
                  var scope = sel.replace(/\s+/g, ' ').trim();
                  var key = (scope === ':root' || scope === 'html' || scope === ':root, :host') ? prop : scope + ' ' + prop;
                  cssVarsDeclared[key] = r.style.getPropertyValue(prop).trim();
                }
              }
            }
          } else if (r.cssRules) {
            walkRules(r.cssRules, sheetHref); // @layer, @supports, @container…
          }
        } catch (e) { /* ignore single rule failures */ }
      }
    }
    var styleSheets = Array.prototype.slice.call(doc.styleSheets);
    for (var s = 0; s < styleSheets.length; s++) {
      var ss = styleSheets[s];
      var rules = null;
      try { rules = ss.cssRules; } catch (e) { rules = null; }
      if (!rules) { sheets.push({ href: ss.href, accessible: false, rules: 0 }); continue; }
      sheets.push({ href: ss.href, accessible: true, rules: rules.length, inline: !ss.href });
      walkRules(rules, ss.href);
    }
    var rootCS = getComputedStyle(doc.documentElement);
    var cssVars = {};
    Object.keys(cssVarsDeclared).forEach(function (k) {
      var name = k.indexOf('--') === 0 ? k : k.slice(k.indexOf('--'));
      cssVars[k] = { declared: cssVarsDeclared[k], computed: rootCS.getPropertyValue(name).trim() || null };
    });

    /* ---------- fonts ---------- */
    var loadedFonts = {};
    try {
      doc.fonts.forEach(function (f) {
        var fam = f.family.replace(/["']/g, '');
        var k = fam + '|' + f.weight + '|' + f.style;
        loadedFonts[k] = { family: fam, weight: f.weight, style: f.style, status: f.status };
      });
    } catch (e) { }
    var googleFontLinks = qa('link[href*="fonts.googleapis.com"], link[href*="fonts.bunny.net"], link[href*="use.typekit.net"], link[href*="fonts.adobe.com"]').map(function (l) { return l.href; });

    /* ---------- element sweep: colours, typography, spacing, containers, animations ---------- */
    var els = qa('body *').slice(0, MAX_ELEMENTS);
    var bgColors = {}, textColors = {}, borderColors = {}, gradients = {};
    var familiesUsed = {};
    var typo = {};
    var spacing = {}, radii = {}, shadows = {}, containers = {}, zIndexes = {};
    var animated = [], transitions = {}, transitionCount = 0, transformCount = 0;
    var stickies = [];
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, PATH: 1, G: 1, DEFS: 1, LINEARGRADIENT: 1, STOP: 1, CIRCLE: 1, RECT: 1, USE: 1, SYMBOL: 1, CLIPPATH: 1, MASK: 1, POLYGON: 1, LINE: 1, ELLIPSE: 1, TSPAN: 1 };
    var TEXT_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, P: 1, A: 1, BUTTON: 1, LI: 1, SPAN: 1, LABEL: 1, SMALL: 1, BLOCKQUOTE: 1, CODE: 1, PRE: 1, STRONG: 1, EM: 1, TD: 1, TH: 1, DT: 1, DD: 1, FIGCAPTION: 1, SUMMARY: 1, LEGEND: 1, INPUT: 1, TEXTAREA: 1, DIV: 1 };

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (SKIP[el.tagName]) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      var area = r.width * r.height;
      if (area <= 0) continue;

      // backgrounds (area weighted)
      var bgHex = toHex(cs.backgroundColor);
      if (bgHex) inc(bgColors, bgHex, Math.min(area, vw * vh * 2));
      var bgi = cs.backgroundImage;
      if (bgi && bgi !== 'none' && /gradient\(/.test(bgi)) inc(gradients, clip(bgi, 300), area);

      // borders
      var sides = ['Top', 'Right', 'Bottom', 'Left'];
      for (var b = 0; b < 4; b++) {
        if (num(cs['border' + sides[b] + 'Width']) > 0 && cs['border' + sides[b] + 'Style'] !== 'none') {
          var bc = toHex(cs['border' + sides[b] + 'Color']);
          if (bc) inc(borderColors, bc, r.width + r.height);
        }
      }

      // text
      var dt = directText(el);
      if (dt.length > 0 && TEXT_TAGS[el.tagName]) {
        var chars = dt.length;
        var colHex = toHex(cs.color);
        if (colHex) inc(textColors, colHex, chars);
        var fam = firstFamily(cs.fontFamily);
        inc(familiesUsed, fam, chars);
        var tag = el.tagName.toLowerCase();
        var key = [tag, fam, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.textTransform, colHex].join('|');
        if (!typo[key]) typo[key] = { tag: tag, fontFamily: fam, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, fontStyle: cs.fontStyle, color: colHex, count: 0, sample: clip(dt, 60), selector: selectorFor(el) };
        typo[key].count++;
      }

      // spacing scale
      ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'].forEach(function (p) {
        var v = cs[p];
        if (v && v !== '0px' && v !== 'normal' && /px$/.test(v)) inc(spacing, v);
      });
      if (cs.borderRadius && cs.borderRadius !== '0px') inc(radii, /e\+|^\d{5,}px/.test(cs.borderRadius) ? '9999px (pill)' : cs.borderRadius);
      if (cs.boxShadow && cs.boxShadow !== 'none') inc(shadows, clip(cs.boxShadow, 200));
      if (cs.zIndex && cs.zIndex !== 'auto' && +cs.zIndex > 0) inc(zIndexes, cs.zIndex);

      // containers
      var mw = num(cs.maxWidth);
      if (cs.maxWidth !== 'none' && mw && mw >= 480 && r.width >= 300) inc(containers, cs.maxWidth + ' (padding-x ' + cs.paddingLeft + ')');

      // motion
      if (cs.animationName && cs.animationName !== 'none' && animated.length < 40) {
        animated.push({ selector: selectorFor(el), name: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction, iteration: cs.animationIterationCount, delay: cs.animationDelay });
      }
      if (cs.transitionDuration && cs.transitionDuration !== '0s' && cs.transitionDuration.split(',').some(function (d) { return parseFloat(d) > 0; })) {
        transitionCount++;
        inc(transitions, clip(cs.transitionProperty + ' ' + cs.transitionDuration + ' ' + cs.transitionTimingFunction, 120));
      }
      if (cs.transform && cs.transform !== 'none') transformCount++;
      if ((cs.position === 'sticky' || cs.position === 'fixed') && stickies.length < 30) {
        stickies.push({ selector: selectorFor(el), position: cs.position, top: cs.top, bottom: cs.bottom, zIndex: cs.zIndex, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, text: clip(txt(el), 60), backdropFilter: cs.backdropFilter !== 'none' ? cs.backdropFilter : null });
      }
    }

    var bodyCS = getComputedStyle(doc.body);
    var typography = Object.keys(typo).map(function (k) { return typo[k]; })
      .sort(function (a, b) { return b.count - a.count; });
    var typoByTag = {};
    typography.forEach(function (t) {
      if (!typoByTag[t.tag]) typoByTag[t.tag] = [];
      if (typoByTag[t.tag].length < 6) typoByTag[t.tag].push(t);
    });

    /* ---------- sections ---------- */
    var sections = [];
    var LANDMARK = { HEADER: 1, FOOTER: 1, NAV: 1, SECTION: 1, ARTICLE: 1, ASIDE: 1, MAIN: 1 };
    function significantChildren(el) {
      return Array.prototype.filter.call(el.children, function (c) {
        if (SKIP[c.tagName]) return false;
        var rr = c.getBoundingClientRect();
        return rr.height >= 24 && rr.width >= 100;
      });
    }
    function pushSection(el, depth) {
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      var heading = el.querySelector('h1, h2, h3');
      var imgs = el.querySelectorAll('img, picture, video, svg, canvas').length;
      var btns = qa('a, button', el).filter(function (b) { return isButtonLike(b); }).slice(0, 6).map(function (b) { return clip(txt(b), 40); });
      sections.push({
        index: sections.length,
        depth: depth,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: classList(el, 100),
        selector: selectorFor(el),
        rect: { x: Math.round(r.left), y: Math.round(r.top + win.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
        background: toHex(cs.backgroundColor),
        backgroundImage: cs.backgroundImage !== 'none' ? clip(cs.backgroundImage, 200) : null,
        heading: heading ? clip(txt(heading), 120) : null,
        headingTag: heading ? heading.tagName.toLowerCase() : null,
        textPreview: clip(txt(el), 200),
        wordCount: txt(el).split(' ').filter(Boolean).length,
        mediaCount: imgs,
        ctas: btns,
        display: cs.display,
        position: cs.position
      });
    }
    function isButtonLike(el) {
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /submit|button/.test(el.type))) return true;
      if (el.tagName !== 'A') return false;
      var c = (el.className || '').toString().toLowerCase();
      if (/btn|button|cta/.test(c)) return true;
      var cs = getComputedStyle(el);
      var bg = parseColor(cs.backgroundColor);
      var hasBg = bg && bg.a > 0;
      var hasBorder = num(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
      var padded = num(cs.paddingLeft) >= 10 && num(cs.paddingTop) >= 4;
      return (hasBg || hasBorder) && padded;
    }
    function collectSections(el, depth) {
      if (sections.length >= 60 || depth > 6) return;
      var kids = significantChildren(el);
      for (var k = 0; k < kids.length; k++) {
        var c = kids[k];
        var r = c.getBoundingClientRect();
        if (r.height < 40) continue;
        var grand = significantChildren(c);
        var isLandmark = LANDMARK[c.tagName];
        var isWrapper = !isLandmark && c.tagName === 'DIV' && (r.height > vh * 2.5 || (grand.length >= 2 && grand.every(function (g) { return g.getBoundingClientRect().height > vh * 0.6 || LANDMARK[g.tagName]; })));
        if (c.tagName === 'MAIN' || isWrapper) {
          if (grand.length) { collectSections(c, depth + 1); continue; }
        }
        pushSection(c, depth);
      }
    }
    collectSections(doc.body, 0);
    sections.sort(function (a, b) { return a.rect.y - b.rect.y; });
    sections.forEach(function (s, i) { s.index = i; });

    /* ---------- header / nav ---------- */
    var header = q('header') || q('[role="banner"]') || q('nav');
    var navLinks = header ? qa('a', header).map(function (a) { return { text: clip(txt(a) || a.getAttribute('aria-label') || '', 40), href: a.href, visible: isVisible(a) }; }) : [];
    var burger = header ? qa('button', header).filter(function (b) { var l = (b.getAttribute('aria-label') || '') + ' ' + (b.className || '') + ' ' + txt(b); return /menu|burger|hamburger|toggle|nav/i.test(l) && isVisible(b); }).length : 0;
    var headerCS = header ? getComputedStyle(header) : null;
    var nav = {
      selector: header ? selectorFor(header) : null,
      links: navLinks,
      visibleLinks: navLinks.filter(function (l) { return l.visible; }).length,
      hasBurger: burger > 0,
      position: headerCS ? headerCS.position : null,
      height: header ? Math.round(header.getBoundingClientRect().height) : null,
      background: headerCS ? toHex(headerCS.backgroundColor) : null,
      backdropFilter: headerCS && headerCS.backdropFilter !== 'none' ? headerCS.backdropFilter : null,
      logo: (function () {
        if (!header) return null;
        var l = header.querySelector('img, svg');
        if (!l) return null;
        var rr = l.getBoundingClientRect();
        return { tag: l.tagName.toLowerCase(), src: l.tagName === 'IMG' ? (l.currentSrc || l.src) : null, w: Math.round(rr.width), h: Math.round(rr.height), inlineSvg: l.tagName.toLowerCase() === 'svg' ? clip(l.outerHTML, 20000) : null };
      })()
    };
    var footer = q('footer') || q('[role="contentinfo"]');
    var footerLinks = footer ? qa('a', footer).map(function (a) { return { text: clip(txt(a), 40), href: a.href }; }).slice(0, 80) : [];

    /* ---------- CTAs / buttons ---------- */
    var ctaMap = {};
    qa('a, button, input[type=submit], input[type=button]').forEach(function (b) {
      if (!isVisible(b) || !isButtonLike(b)) return;
      var cs = getComputedStyle(b);
      var t = clip(txt(b) || b.value || b.getAttribute('aria-label') || '', 50);
      var key = t + '|' + toHex(cs.backgroundColor) + '|' + toHex(cs.color);
      if (ctaMap[key]) { ctaMap[key].count++; return; }
      var rr = b.getBoundingClientRect();
      ctaMap[key] = { text: t, href: b.href || null, selector: selectorFor(b), count: 1, style: { background: toHex(cs.backgroundColor), color: toHex(cs.color), border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + toHex(cs.borderTopColor), borderRadius: cs.borderRadius, padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: firstFamily(cs.fontFamily), boxShadow: cs.boxShadow !== 'none' ? clip(cs.boxShadow, 120) : null, height: Math.round(rr.height), width: Math.round(rr.width) } };
    });
    var ctas = Object.keys(ctaMap).map(function (k) { return ctaMap[k]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 25);

    /* ---------- hover candidates ---------- */
    var hoverCandidates = [];
    var seenHover = {};
    qa('a, button').forEach(function (el) {
      if (hoverCandidates.length >= 24 || !isVisible(el)) return;
      var t = clip(txt(el) || el.getAttribute('aria-label') || '', 40);
      var k = el.tagName + '|' + t;
      if (seenHover[k]) return;
      seenHover[k] = 1;
      hoverCandidates.push({ selector: selectorFor(el), text: t, kind: isButtonLike(el) ? 'button' : 'link' });
    });
    qa('[class*="card" i], article').slice(0, 6).forEach(function (el) {
      if (isVisible(el)) hoverCandidates.push({ selector: selectorFor(el), text: clip(txt(el), 40), kind: 'card' });
    });

    /* ---------- images / media ---------- */
    var images = qa('img').map(function (img) {
      var rr = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src, srcAttr: img.getAttribute('src'), srcset: img.getAttribute('srcset') ? clip(img.getAttribute('srcset'), 600) : null,
        // srcset candidates sorted largest-first (by w or x descriptor) — the clone only needs the biggest
        srcsetUrls: img.getAttribute('srcset') ? img.getAttribute('srcset').split(',').map(function (p) { var parts = p.trim().split(/\s+/); return { url: abs(parts[0]), size: parseFloat(parts[1]) || 0 }; }).filter(function (c) { return c.url; }).sort(function (a, b) { return b.size - a.size; }).map(function (c) { return c.url; }).slice(0, 12) : [],
        alt: img.alt || null, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        renderedWidth: Math.round(rr.width), renderedHeight: Math.round(rr.height),
        loading: img.getAttribute('loading'), inPicture: img.parentElement && img.parentElement.tagName === 'PICTURE',
        objectFit: getComputedStyle(img).objectFit, borderRadius: getComputedStyle(img).borderRadius,
        selector: selectorFor(img), visible: isVisible(img)
      };
    });
    var bgImages = [];
    els.forEach(function (el) {
      if (SKIP[el.tagName] || bgImages.length >= 80) return;
      var bgi;
      try { bgi = getComputedStyle(el).backgroundImage; } catch (e) { return; }
      if (!bgi || bgi === 'none' || /gradient\(/.test(bgi) && !/url\(/.test(bgi)) return;
      var re = /url\((['"]?)(.*?)\1\)/g, m;
      while ((m = re.exec(bgi))) {
        if (/^data:/.test(m[2])) continue;
        var rr = el.getBoundingClientRect();
        bgImages.push({ url: abs(m[2]), selector: selectorFor(el), renderedWidth: Math.round(rr.width), renderedHeight: Math.round(rr.height), size: getComputedStyle(el).backgroundSize, position: getComputedStyle(el).backgroundPosition });
      }
    });
    var inlineSvgs = qa('svg').filter(function (s) { return !s.closest('svg') || s.closest('svg') === s; }).slice(0, 80).map(function (s) {
      var rr = s.getBoundingClientRect();
      var html = s.outerHTML;
      return { selector: selectorFor(s), w: Math.round(rr.width), h: Math.round(rr.height), bytes: html.length, markup: html.length <= 30000 ? html : null, inHeader: !!(header && header.contains(s)), ariaLabel: s.getAttribute('aria-label') || null, hasUse: !!s.querySelector('use') };
    });
    var videos = qa('video').map(function (v) {
      var rr = v.getBoundingClientRect();
      return { src: v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : null), poster: v.poster || null, autoplay: v.autoplay, loop: v.loop, muted: v.muted, controls: v.controls, playsInline: v.playsInline, w: Math.round(rr.width), h: Math.round(rr.height), selector: selectorFor(v) };
    });
    var iframes = qa('iframe').map(function (f) { return { src: f.src, title: f.title || null, w: f.clientWidth, h: f.clientHeight }; });
    var canvases = qa('canvas').length;
    var lottie = qa('lottie-player, [data-lottie], dotlottie-player, .lottie').length;

    /* ---------- links (for crawling) ---------- */
    var internal = {};
    qa('a[href]').forEach(function (a) {
      try {
        var u = new URL(a.href);
        if (u.origin !== location.origin) return;
        if (/^(mailto|tel|javascript):/.test(a.getAttribute('href'))) return;
        var path = u.pathname.replace(/\/$/, '') || '/';
        if (!internal[path]) internal[path] = { path: path, url: u.origin + u.pathname, text: clip(txt(a), 40), inNav: !!(header && header.contains(a)), inFooter: !!(footer && footer.contains(a)) };
      } catch (e) { }
    });
    var internalLinks = Object.keys(internal).map(function (k) { return internal[k]; });
    var externalDomains = {};
    qa('a[href^="http"]').forEach(function (a) { try { var u = new URL(a.href); if (u.origin !== location.origin) inc(externalDomains, u.hostname); } catch (e) { } });

    /* ---------- scripts, frameworks, third parties ---------- */
    var scripts = qa('script[src]').map(function (s) { return s.src; });
    var html = doc.documentElement.outerHTML;
    var detect = [];
    function has(cond, label) { if (cond) detect.push(label); }
    has(win.__NEXT_DATA__ || q('#__next') || /self\.__next_f/.test(html) || /\/_next\//.test(html), 'Next.js');
    has(win.__NUXT__ || q('#__nuxt') || /\/_nuxt\//.test(html), 'Nuxt');
    has(q('#___gatsby'), 'Gatsby');
    has(/data-astro-cid|astro-island/.test(html), 'Astro');
    has(/__remixContext/.test(html), 'Remix');
    has(/__sveltekit|data-sveltekit/.test(html), 'SvelteKit');
    has(doc.documentElement.hasAttribute('data-wf-page') || doc.documentElement.hasAttribute('data-wf-site') || /webflow\.js/.test(html), 'Webflow');
    has(/framerusercontent\.com|data-framer-name|__framer/.test(html), 'Framer');
    has(/wp-content|wp-includes/.test(html), 'WordPress');
    has(win.Shopify || /cdn\.shopify\.com/.test(html), 'Shopify');
    has(/squarespace/.test(html), 'Squarespace');
    has(/wixstatic|_wix/.test(html), 'Wix');
    has(/vercel\.live|vercel-insights/.test(html), 'Vercel hosting');
    has(win.Vue || qa('[data-v-]').length || /data-v-[0-9a-f]{8}/.test(html), 'Vue');
    has(win.React || (doc.body.firstElementChild && Object.keys(doc.body.firstElementChild).some(function (k) { return /^__react/.test(k); })) || q('[data-reactroot]'), 'React');
    has(win.Alpine, 'Alpine.js');
    has(win.jQuery, 'jQuery ' + (win.jQuery ? win.jQuery.fn.jquery : ''));
    has(/--tw-|tailwindcss|\btw-\b/.test(html) || Object.keys(cssVarsDeclared).some(function (k) { return /^--(color|spacing|font|radius)-/.test(k); }) && /\bflex\b.*\bitems-center\b/.test(html), 'Tailwind CSS');
    has(/--bs-/.test(html) || q('link[href*="bootstrap"]'), 'Bootstrap');
    has(win.gsap, 'GSAP' + (win.ScrollTrigger || (win.gsap && win.gsap.plugins && win.gsap.plugins.ScrollTrigger) ? ' + ScrollTrigger' : ''));
    has(win.Lenis || /lenis/.test(html), 'Lenis smooth scroll');
    has(win.LocomotiveScroll || /locomotive-scroll/.test(html), 'Locomotive Scroll');
    has(win.Swiper || q('.swiper'), 'Swiper');
    has(q('.slick-slider'), 'Slick');
    has(win.THREE || /three(\.module)?(\.min)?\.js/.test(html), 'Three.js');
    has(/framer-motion|motion\.dev|data-projection-id/.test(html) || qa('[style*="transform: translate"]').length > 20, 'Framer Motion / motion (likely)');
    has(win.AOS || q('[data-aos]'), 'AOS');
    has(win.lottie || lottie, 'Lottie');
    has(win.Splide || q('.splide'), 'Splide');
    has(q('.keen-slider') || q('.embla'), 'Embla/Keen slider');
    has(/typed\.js|typewriter/.test(html), 'typed.js');
    has(win.particlesJS || win.tsParticles, 'particles');
    has(q('[data-radix-collection-item], [data-radix-popper-content-wrapper], [data-state]') && /radix/.test(html) || qa('[data-slot]').length > 10, 'Radix UI / shadcn (likely)');
    has(qa('.MuiBox-root, [class*="Mui"]').length, 'Material UI');
    has(qa('.chakra-').length || /chakra-ui/.test(html), 'Chakra UI');
    has(qa('[class*="mantine-"]').length, 'Mantine');
    var analytics = [];
    function anal(cond, label) { if (cond) analytics.push(label); }
    anal(win.gtag || /googletagmanager\.com\/gtag|google-analytics\.com/.test(html), 'Google Analytics');
    anal(win.google_tag_manager || /googletagmanager\.com\/gtm/.test(html), 'Google Tag Manager');
    anal(win.fbq || /connect\.facebook\.net/.test(html), 'Meta Pixel');
    anal(win.hj || /hotjar/.test(html), 'Hotjar');
    anal(win.clarity || /clarity\.ms/.test(html), 'Microsoft Clarity');
    anal(win.plausible || /plausible\.io/.test(html), 'Plausible');
    anal(win.posthog || /posthog/.test(html), 'PostHog');
    anal(win.analytics && win.analytics.track || /segment\.com|cdn\.segment/.test(html), 'Segment');
    anal(win.Intercom || /intercom/.test(html), 'Intercom');
    anal(win.$crisp || /crisp\.chat/.test(html), 'Crisp');
    anal(/hs-scripts\.com|hubspot/.test(html), 'HubSpot');
    anal(/js\.stripe\.com/.test(html), 'Stripe.js');
    anal(/tawk\.to/.test(html), 'Tawk.to');
    anal(/umami/.test(html), 'Umami');
    anal(/cdn\.vercel-insights|\/_vercel\/insights/.test(html), 'Vercel Analytics');
    anal(/mixpanel/.test(html), 'Mixpanel');
    anal(/amplitude/.test(html), 'Amplitude');
    anal(/sentry/.test(html), 'Sentry');
    anal(/cookiebot|onetrust|didomi|axeptio|tarteaucitron|cookieyes|iubenda|klaro|osano|usercentrics/i.test(html), 'Cookie consent manager');

    /* ---------- forms ---------- */
    var forms = qa('form').slice(0, 15).map(function (f) {
      return {
        selector: selectorFor(f), action: f.action || null, method: f.method || null,
        fields: qa('input, textarea, select', f).filter(function (i) { return i.type !== 'hidden'; }).map(function (i) { return { tag: i.tagName.toLowerCase(), type: i.type || null, name: i.name || null, placeholder: i.placeholder || null, required: i.required, autocomplete: i.autocomplete || null }; }),
        submit: (function () { var b = f.querySelector('button, input[type=submit]'); return b ? clip(txt(b) || b.value, 40) : null; })()
      };
    });
    var standaloneInputs = qa('input:not(form input), textarea:not(form textarea)').filter(function (i) { return i.type !== 'hidden' && isVisible(i); }).map(function (i) { return { type: i.type, placeholder: i.placeholder || null, selector: selectorFor(i) }; }).slice(0, 15);

    /* ---------- text outline (markdown-ish) ---------- */
    var outline = [];
    var lastText = '';
    qa('h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, a, button, dt, dd, summary, label, span, td, th').forEach(function (el) {
      if (outline.length >= 1500) return;
      if (el.closest('script, style, noscript')) return;
      var t;
      if (/^H[1-6]$/.test(el.tagName)) {
        t = txt(el); if (!t || t === lastText) return;
        outline.push('#'.repeat(+el.tagName[1]) + ' ' + t);
      } else if (el.tagName === 'A' || el.tagName === 'BUTTON') {
        t = txt(el); if (!t || t === lastText) return;
        if (isButtonLike(el)) outline.push('[' + (el.tagName === 'A' ? 'cta' : 'button') + '] ' + t + (el.href ? ' → ' + el.href : ''));
        else if (!el.closest('p, li, h1, h2, h3, h4, h5, h6')) outline.push('[link] ' + t + (el.href ? ' → ' + el.href : ''));
      } else if (el.tagName === 'SPAN' || el.tagName === 'DD' || el.tagName === 'DT' || el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'LABEL') {
        if (el.closest('p, li, h1, h2, h3, h4, h5, h6, a, button')) return;
        t = directText(el); if (!t || t.length < 2 || t === lastText) return;
        outline.push(t);
      } else {
        if (el.tagName === 'LI' && el.querySelector('p, h1, h2, h3, h4, h5, h6')) return;
        t = txt(el); if (!t || t === lastText) return;
        outline.push((el.tagName === 'LI' ? '- ' : el.tagName === 'BLOCKQUOTE' ? '> ' : '') + t);
      }
      lastText = t;
    });

    /* ---------- DOM outline ---------- */
    var domLines = [];
    function domWalk(el, depth) {
      if (domLines.length >= 700 || depth > 7 || SKIP[el.tagName]) return;
      var r = el.getBoundingClientRect();
      if ((r.width === 0 && r.height === 0) && el.tagName !== 'BODY') return;
      var cs = getComputedStyle(el);
      var label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (classList(el, 60) ? '.' + classList(el, 60).split(/\s+/).slice(0, 4).join('.') : '');
      var layout = cs.display === 'flex' || cs.display === 'inline-flex' ? ' flex' + (cs.flexDirection === 'column' ? '-col' : '') + (cs.justifyContent !== 'normal' && cs.justifyContent !== 'flex-start' ? ' jc:' + cs.justifyContent : '') + (cs.alignItems !== 'normal' && cs.alignItems !== 'stretch' ? ' ai:' + cs.alignItems : '') + (cs.gap !== 'normal' && cs.gap !== '0px' ? ' gap:' + cs.gap : '') : cs.display === 'grid' ? ' grid cols:' + clip(cs.gridTemplateColumns, 60) + (cs.gap !== 'normal' && cs.gap !== '0px' ? ' gap:' + cs.gap : '') : '';
      var t = directText(el);
      domLines.push('  '.repeat(depth) + label + ' [' + Math.round(r.width) + 'x' + Math.round(r.height) + ']' + layout + (t ? ' "' + clip(t, 40) + '"' : '') + (el.tagName === 'IMG' ? ' src=' + clip((el.currentSrc || el.src || '').split('/').pop(), 50) : ''));
      for (var i = 0; i < el.children.length && i < 40; i++) domWalk(el.children[i], depth + 1);
    }
    domWalk(doc.body, 0);

    /* ---------- page-level ---------- */
    var page = {
      scrollHeight: Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight),
      viewport: { w: vw, h: vh },
      rootFontSize: rootCS.fontSize,
      body: { background: toHex(bodyCS.backgroundColor), color: toHex(bodyCS.color), fontFamily: bodyCS.fontFamily, fontSize: bodyCS.fontSize, lineHeight: bodyCS.lineHeight, letterSpacing: bodyCS.letterSpacing, fontWeight: bodyCS.fontWeight },
      htmlBackground: toHex(rootCS.backgroundColor),
      colorScheme: rootCS.colorScheme,
      scrollBehavior: rootCS.scrollBehavior,
      scrollSnap: qa('*').slice(0, 2000).some(function (e) { try { return getComputedStyle(e).scrollSnapType !== 'none'; } catch (x) { return false; } }),
      darkModeMedia: Object.keys(mediaQueries).some(function (m) { return /prefers-color-scheme/.test(m); }),
      reducedMotionMedia: Object.keys(mediaQueries).some(function (m) { return /prefers-reduced-motion/.test(m); }),
      hasDarkClassToggle: /\bdark\b/.test(doc.documentElement.className) || doc.documentElement.hasAttribute('data-theme'),
      customCursor: qa('[class*="cursor" i]').filter(function (e) { var cs = getComputedStyle(e); return cs.position === 'fixed' && cs.pointerEvents === 'none'; }).length > 0,
      elementCount: doc.getElementsByTagName('*').length,
      truncatedSweep: qa('body *').length > MAX_ELEMENTS
    };

    return {
      extractedAt: new Date().toISOString(),
      meta: meta,
      page: page,
      fonts: {
        loaded: Object.keys(loadedFonts).map(function (k) { return loadedFonts[k]; }),
        faces: fontFaces,
        externalLinks: googleFontLinks,
        familiesUsed: top(familiesUsed, 12)
      },
      cssVars: cssVars,
      palette: {
        backgrounds: top(bgColors, 25, 1),
        text: top(textColors, 20, 1),
        borders: top(borderColors, 15, 1),
        gradients: top(gradients, 10, 1)
      },
      typography: { byTag: typoByTag, top: typography.slice(0, 50) },
      layout: {
        containers: top(containers, 10),
        breakpoints: top(breakpoints, 20),
        spacingScale: top(spacing, 24),
        radii: top(radii, 10),
        shadows: top(shadows, 10),
        zIndexes: top(zIndexes, 10),
        stickies: stickies
      },
      sections: sections,
      nav: nav,
      footerLinks: footerLinks,
      ctas: ctas,
      hoverCandidates: hoverCandidates,
      media: { images: images, backgroundImages: bgImages, inlineSvgs: inlineSvgs, videos: videos, iframes: iframes, canvases: canvases, lottie: lottie },
      links: { internal: internalLinks, externalDomains: top(externalDomains, 20) },
      tech: { detected: detect, analytics: analytics, scripts: scripts, stylesheets: sheets, inlineStyleTags: inlineStyleCount },
      motion: { animatedElements: animated, keyframes: keyframes, transitionCount: transitionCount, transitionsTop: top(transitions, 12), transformCount: transformCount },
      forms: forms,
      standaloneInputs: standaloneInputs,
      textOutline: outline,
      domOutline: domLines
    };
  }
  window.__copycatExtract = __copycatExtract;
})();

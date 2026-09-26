# copycat

**URL → pixel-perfect website clone, verified by pixel diff.** A [Claude Code](https://claude.com/claude-code) skill.

🇫🇷 [Lire en français](README.fr.md)

Give Claude a URL and get back a reproduction that is visually indistinguishable from the original: same layout, fonts, colours, spacing, responsive behaviour, hover states and animations, running locally with a clean console.

The difference between an average clone and a perfect one is **measurement**. copycat never guesses a font, a colour or a margin: it reads them from the browser. And it never says "looks good" by eye: it diffs the pixels and reads the console.

## What it does

1. **Capture** (Playwright): full-page screenshots, fold-by-fold screenshots on desktop / tablet / mobile, one crop per section, hover states, optional videos.
2. **Extract** everything the browser exposes: `@font-face` + font files, CSS variables, palette, typography scale, containers, breakpoints, sticky elements, keyframes and transitions, images at their rendered size, inline SVGs, meta tags, console and network errors, plus the site's real CSS files and text content.
3. **Rebuild** section by section, top to bottom, from the measured values (static HTML/CSS/JS by default, or Next.js if the repo already uses it).
4. **Verify** in a loop: pixel diff per viewport, worst zones mapped to sections, design diff (missing fonts, colours, headings, CTAs), and the clone's console. Grade A–D, target < 2 % mismatch with 0 console errors.

It handles lazy-loading and reveal-on-scroll, cookie banners (hidden via CSS, never accepted), pages too tall for native capture (fold stitching), cross-origin stylesheets, CSS-relative fonts, image proxies (`/_next/image?url=`) and inline SVG logos.

## Install

Requires Node ≥ 18.

```bash
# personal install (all projects)
git clone https://github.com/minosdevs/copycat-skill ~/.claude/skills/copycat

# or project install
git clone https://github.com/minosdevs/copycat-skill .claude/skills/copycat
```

Then install the scripts' dependencies once:

```bash
cd ~/.claude/skills/copycat/scripts && npm install && npx playwright install chromium
```

## Usage

In Claude Code, just ask:

> clone https://example.com

> make me exactly the same landing page as https://example.com

The skill triggers on "copy", "clone", "replicate", "make the same as X"… You can also run the scripts yourself:

```bash
# 1. capture the original → copycat/example.com/REPORT.md
node scripts/capture.mjs https://example.com --out copycat/example.com

# 2. compare your clone against it → copycat/example.com/compare/REPORT.md
node scripts/compare.mjs --original copycat/example.com --clone http://localhost:3000
```

Useful capture options: `--depth 1` (pages in the nav, `--max-pages 8`), `--viewports desktop,mobile` or `--viewports large:1920x1080,desktop`, `--scale 2`, `--dark`, `--locale en-US`, `--wait 3000`, `--videos`, `--channel chrome|msedge` (real installed browser, for bot-protected sites), `--headed`, `--no-hover`.

`scripts/extract.browser.js` can also be pasted as-is into the DevTools console: `copy(JSON.stringify(__copycatExtract(), null, 2))` puts the page's design tokens in your clipboard.

## Files

| path | role |
|---|---|
| `SKILL.md` | The workflow Claude follows (capture → read → foundations → sections → verify → deliver) |
| `scripts/capture.mjs` | Photographs and dissects the original site |
| `scripts/compare.mjs` | Measures clone vs original (pixel diff, fonts, palette, typography, console) |
| `scripts/extract.browser.js` | In-page design-token extractor |
| `references/fidelity-checklist.md` | The 40 details that make a clone look fake |
| `references/rebuild-recipes.md` | Ready recipes: `@font-face`, reveal-on-scroll, sticky header, burger menu, logo marquee, FAQ accordion… |
| `references/troubleshooting.md` | Blocked sites, blank pages, 404 fonts, proxied images, Lenis smooth-scroll… |

> The skill's instructions (`SKILL.md` and `references/`) are written in French. Claude reads them fine and answers in your language.

## Legal

Cloning a site to learn, prototype or rebuild **your own** site is common practice. Reusing a third party's logo, photos, copy or brand in production is not. copycat never enters credentials, never bypasses logins or paywalls, and tells you to swap brand assets for placeholders when the clone isn't for your own use.

## License

[MIT](LICENSE) © minosdevs

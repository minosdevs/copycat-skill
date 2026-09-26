# copycat

**URL → clone pixel-perfect d'un site, vérifié par diff pixel.** Un skill [Claude Code](https://claude.com/claude-code).

🇬🇧 [Read in English](README.md)

Tu donnes une URL à Claude, il te rend une reproduction visuellement indiscernable de l'original : même layout, mêmes fonts, couleurs, espacements, responsive, hover et animations, qui tourne en local avec une console propre.

Ce qui sépare un clone moyen d'un clone parfait, c'est la **mesure**. copycat ne devine jamais une font, une couleur ou une marge : il les lit dans le navigateur. Et il ne dit jamais « c'est bon » à l'œil : il diffe les pixels et lit la console.

## Ce qu'il fait

1. **Capture** (Playwright) : screens full-page, screens fold par fold sur desktop / tablette / mobile, un crop par section, états hover, vidéos en option.
2. **Extraction** de tout ce que le navigateur expose : `@font-face` + fichiers de fonts, variables CSS, palette, échelle typo, containers, breakpoints, éléments sticky, keyframes et transitions, images à leur taille rendue, SVG inline, meta, erreurs console et réseau, plus les vrais fichiers CSS et le texte du site.
3. **Reconstruction** section par section, de haut en bas, à partir des valeurs mesurées (HTML/CSS/JS statique par défaut, ou Next.js si le repo l'utilise déjà).
4. **Vérification** en boucle : diff pixel par viewport, zones les plus différentes mappées aux sections, diff design (fonts, couleurs, titres, CTA manquants) et console du clone. Note de A à D, objectif < 2 % d'écart avec 0 erreur console.

Il gère le lazy-load et les reveal-on-scroll, les bannières cookies (masquées en CSS, jamais acceptées), les pages trop hautes pour la capture native (stitching des folds), les stylesheets cross-origin, les fonts relatives au CSS, les proxys d'images (`/_next/image?url=`) et les logos en SVG inline.

## Installation

Node ≥ 18 requis.

```bash
# install perso (tous les projets)
git clone https://github.com/minosdevs/copycat-skill ~/.claude/skills/copycat

# ou install projet
git clone https://github.com/minosdevs/copycat-skill .claude/skills/copycat
```

Puis installe une fois les dépendances des scripts :

```bash
cd ~/.claude/skills/copycat/scripts && npm install && npx playwright install chromium
```

## Utilisation

Dans Claude Code, demande simplement :

> clone https://exemple.com

> fais-moi exactement la même landing que https://exemple.com

Le skill se déclenche sur « copie », « clone », « reproduis », « fais pareil que X »… Tu peux aussi lancer les scripts toi-même :

```bash
# 1. capturer l'original → copycat/exemple.com/REPORT.md
node scripts/capture.mjs https://exemple.com --out copycat/exemple.com

# 2. comparer ton clone → copycat/exemple.com/compare/REPORT.md
node scripts/compare.mjs --original copycat/exemple.com --clone http://localhost:3000
```

Options utiles de la capture : `--depth 1` (pages du nav, `--max-pages 8`), `--viewports desktop,mobile` ou `--viewports large:1920x1080,desktop`, `--scale 2`, `--dark`, `--locale fr-FR`, `--wait 3000`, `--videos`, `--channel chrome|msedge` (vrai navigateur installé, pour les sites protégés), `--headed`, `--no-hover`.

`scripts/extract.browser.js` se colle aussi tel quel dans la console DevTools : `copy(JSON.stringify(__copycatExtract(), null, 2))` met les design tokens de la page dans ton presse-papier.

## Fichiers

| chemin | rôle |
|---|---|
| `SKILL.md` | Le workflow suivi par Claude (capturer → lire → fondations → sections → vérifier → livrer) |
| `scripts/capture.mjs` | Photographie et dissèque le site original |
| `scripts/compare.mjs` | Mesure l'écart clone vs original (diff pixel, fonts, palette, typo, console) |
| `scripts/extract.browser.js` | Extracteur de design tokens in-page |
| `references/fidelity-checklist.md` | Les 40 détails qui font qu'un clone paraît faux |
| `references/rebuild-recipes.md` | Recettes prêtes : `@font-face`, reveal-on-scroll, header sticky, burger, marquee de logos, accordéon FAQ… |
| `references/troubleshooting.md` | Sites bloqués, pages blanches, fonts en 404, images proxifiées, smooth-scroll Lenis… |

## Légal

Cloner un site pour apprendre, prototyper ou refaire **ton propre** site, c'est courant. Réutiliser en production le logo, les photos, les textes ou la marque d'un tiers, non. copycat ne saisit jamais d'identifiants, ne contourne ni login ni paywall, et te dit de remplacer les assets de marque par des placeholders si le clone n'est pas pour ton propre usage.

## Licence

[MIT](LICENSE) © minosdevs

---
name: copycat
description: >
  Clone un site web à l'identique à partir d'une URL : capture Playwright complète (screens full-page
  + fold par fold sur desktop/tablet/mobile, crops par section, états hover), extraction de tout ce que
  le navigateur expose (fonts, variables CSS, palette, typo, layout, breakpoints, animations, assets,
  console/network), reconstruction section par section, puis boucle de vérification par diff pixel et
  console propre. Utilise ce skill DÈS QUE l'utilisateur veut copier, cloner, répliquer, reproduire,
  « refaire pareil », s'inspirer fortement d'un site, d'une landing page, d'un template ou d'une page
  précise (« fais-moi la même chose que X », « copie ce site », « reproduis cette landing », « clone
  neverboring.ai », « je veux exactement ce design »), même s'il ne dit pas « clone ». Aussi pour
  auditer visuellement un site existant (screens complets, design tokens, fonts utilisées).
---

# copycat — URL → clone pixel-perfect

Le but : partir d'une URL et livrer une reproduction **visuellement indiscernable** (layout, fonts,
couleurs, espacements, responsive, hover, animations) qui tourne localement avec une console propre.
Pas une « inspiration », pas un « dans l'esprit de » : le même site.

Ce qui fait la différence entre un clone moyen et un clone parfait, c'est la **mesure**. On ne devine
jamais une font, une couleur ou un espacement : on les lit dans le navigateur. Et on ne déclare pas
« c'est bon » à l'œil : on diffe les pixels et on lit la console.

## Les 3 scripts (dossier `scripts/`)

| script | rôle |
|---|---|
| `capture.mjs <url>` | Photographie et dissèque le site original → dossier `copycat/<host>/` avec `REPORT.md` |
| `compare.mjs --original <dir> --clone <url>` | Mesure l'écart clone vs original (diff pixel, fonts, palette, typo, console) → `compare/REPORT.md` |
| `extract.browser.js` | L'extracteur in-page, aussi collable tel quel dans la console DevTools (retourne le JSON des design tokens) |

Installation une seule fois (Node ≥ 18) :

```bash
cd <chemin-du-skill>/scripts && npm install && npx playwright install chromium
```

`<chemin-du-skill>` est le dossier de ce SKILL.md (`~/.claude/skills/copycat` en install perso,
`.claude/skills/copycat` en install projet, ou le cache du plugin). Vérifie avec `ls` avant de lancer.

## Workflow

### 0. Cadrer (30 secondes, pas plus)

- **URL cible** : celle donnée. S'il y a plusieurs pages à cloner, c'est `--depth 1` (pages du nav).
- **Stack de sortie** : regarde le repo courant. `package.json` avec `next` → composants Next.js
  (App Router, Tailwind si déjà présent). Sinon, repo vide ou pas de framework → **HTML/CSS/JS
  statique** (`index.html`, `styles.css`, `script.js`, `assets/`). Le statique est le plus fidèle et le
  plus simple : c'est le défaut si l'utilisateur ne précise rien. Ne propose pas un framework qu'il n'a
  pas demandé.
- **Périmètre** : on clone le front. Les formulaires pointent vers rien (ou un `console.log`), l'auth,
  le paiement et les widgets tiers (Intercom, analytics) ne sont pas reproduits — dis-le à la fin.
- **Légal, en une ligne dans le livrable** : reproduire un site pour apprendre, prototyper ou
  refaire son *propre* site est courant ; réutiliser en production le logo, les photos, les textes ou la
  marque d'un tiers ne l'est pas. Remplace les assets de marque par des placeholders si l'utilisateur
  destine le clone à un autre usage que le sien / l'étude.

### 1. Capturer

```bash
node <chemin-du-skill>/scripts/capture.mjs https://exemple.com --out copycat/exemple.com
```

Options utiles : `--depth 1` (pages du nav, max `--max-pages 8`), `--viewports desktop,mobile` ou
`--viewports large:1920x1080,desktop`, `--scale 2` (retina, plus lourd), `--dark`, `--locale fr-FR`,
`--wait 3000` (sites lents / animations d'intro), `--videos`, `--channel chrome|msedge` (vrai navigateur
installé, pour les sites protégés), `--headed` (voir ce qui se passe), `--no-hover` (plus rapide). Compte 1 à 2 minutes pour 3 viewports.

Le script gère déjà : le scroll complet pour déclencher le lazy-load et les reveal-on-scroll, les
bannières cookies (masquées en CSS, **sans** cliquer « accepter »), les pages trop hautes pour la
capture native (stitching des folds), les stylesheets cross-origin (téléchargées), les `@font-face`
relatifs au CSS, les proxys d'images (`/_next/image?url=`), les SVG inline (logos).

Si le site bloque le headless (Cloudflare, page blanche, 403, screenshot qui time out) : relance avec `--channel chrome` (le vrai Chrome installé, en headless — passe la plupart des murs anti-bot), sinon `--headed`, ou ouvre
l'URL dans le Browser pane, fais les screenshots à la main avec `computer` et exécute le contenu de
`extract.browser.js` via `javascript_tool` puis `JSON.stringify(__copycatExtract())`. Tu obtiens le
même JSON que `manifest.json → design`.

### 2. Lire la capture — dans cet ordre

1. `REPORT.md` en entier. La section « TL;DR for the rebuild » te donne stack, fonts, body, containers,
   breakpoints, header, motion. Les warnings en bas disent ce qui n'a pas été capturé.
2. Les **folds** de `screens/desktop/` un par un (outil Read sur les PNG). C'est la vue la plus fiable :
   un vrai viewport à une vraie position de scroll. Note pour chaque fold ce que tu vois — alignements,
   largeur de colonne, rythme vertical, où sont les ombres et les bordures.
3. Les crops `screens/sections/NN-*.png` au moment de construire la section NN.
4. `screens/mobile/` avant d'écrire le responsive, pas après.
5. `content/text.md` pour le texte exact (copie-colle, ne retape pas — les apostrophes typographiques,
   les espaces insécables et les majuscules comptent).
6. `css/*.css` quand une valeur te manque : c'est le CSS **réel** du site. Cherche dedans la classe
   ou le sélecteur vu dans `content/dom-outline.txt` plutôt que d'inventer.
7. `manifest.json` pour le détail (`design.typography.top`, `design.ctas`, `design.layout.stickies`,
   `hover[]`, `design.motion`, `design.media.images[]` avec les tailles rendues).

Charge `references/fidelity-checklist.md` maintenant : c'est la liste de ce qui trahit un clone.

### 3. Poser les fondations avant la première section

Dans cet ordre, parce que tout le reste en dépend :

1. **Fonts** : copie `assets/fonts/` dans le projet, écris les `@font-face` (mêmes `font-family`,
   `font-weight`, `font-style`, `font-display`) à partir de `manifest.design.fonts.faces`. Si la font
   vient de Google Fonts (`fonts.externalLinks`), garde le lien. Si la font est propriétaire et non
   téléchargeable, choisis la plus proche **et dis-le** dans le livrable — c'est le premier écart
   visible d'un clone.
2. **Tokens** : reprends les variables CSS de `:root` telles quelles (noms inclus, ça rend le CSS
   lisible et le diff facile), la palette, `html { font-size }`, `body { background; color; font;
   line-height; letter-spacing }`, `color-scheme`.
3. **Container** : le `max-width` + `padding-x` le plus fréquent de `layout.containers`. Les
   breakpoints de `layout.breakpoints` deviennent tes media queries (mêmes valeurs, même unité).
4. **Header** : position (`fixed`/`sticky`), hauteur, fond, `backdrop-filter`, z-index, le logo (SVG
   inline sauvegardé dans `assets/svg/logo-header.svg`), comportement mobile (burger si
   `nav.hasBurger`).
5. **Meta** : `<title>`, description, favicons (dans `assets/icons/`), `og:*`, `lang`, viewport.

### 4. Construire section par section, de haut en bas

Pour chaque section de la table « Sections » du rapport :

- Ouvre son crop et le fold correspondant. Repère la grille (colonnes, gap), les largeurs réelles
  (`dom-outline.txt` donne `[WxH]` et `flex/grid` avec `gap`), l'alignement vertical.
- Prends les tailles/poids/interlignes dans la table « Typography » — un `h2` à `40px/46px -0.8px`
  se code `font-size:40px; line-height:46px; letter-spacing:-0.8px`, pas « text-4xl ».
- Utilise les **vraies images** (`assets/images/`, nommées d'après la source) aux **tailles rendues**
  du rapport (`renderedWidth × renderedHeight`, `object-fit`, `border-radius`). Les SVG inline vont en
  inline (les icônes de `assets/svg/`).
- Boutons : la table « Buttons / CTAs » a bg, couleur, bordure, radius, padding, font, ombre. Les
  états hover sont dans « Hover states » (`color → …`, `transform → …`, `boxShadow → …`) avec la durée
  de transition dans « Motion » → reproduis-les, un clone sans hover se sent mort.
- Animations : `design.motion.keyframes` liste les noms ; les vraies `@keyframes` sont dans `css/`.
  Copie-les. Les reveal-on-scroll (éléments `opacity:0` + classe ajoutée) se refont en 15 lignes avec
  un `IntersectionObserver` — reproduis le délai et l'easing vus dans « Animated elements ».
- Écris le responsive **en même temps** que la section, en regardant le fold mobile correspondant,
  pas dans une passe finale.

Ne saute pas de section « parce qu'elle est simple ». Le footer et les micro-sections (bandeau logos,
stats) sont ceux qu'on bâcle et qui font « faux ».

### 5. Vérifier — la boucle qui fait le clone

Lance le clone (serveur de dev du projet, ou `npx serve` pour du statique — utilise `preview_start`
avec `.claude/launch.json`, jamais un serveur dans Bash), puis :

```bash
node <chemin-du-skill>/scripts/compare.mjs --original copycat/exemple.com --clone http://localhost:3000
```

Lis `copycat/exemple.com/compare/REPORT.md` :

- **Verdict** A/B/C/D + `% mismatch` par viewport. Vise **< 2 %** avec console propre (A). L'anti-
  aliasing et la compression d'images coûtent déjà 0,5–1,5 %.
- **Worst zones** : les bandes de 200 px les plus différentes, mappées aux sections. Corrige la plus
  haute d'abord — un décalage de hauteur en haut décale tout ce qui suit et gonfle le %.
- **Design diff** : fonts manquantes, couleurs manquantes, typo (`h1 size 56px → 48px`), body,
  titres absents, CTAs absents, meta, compteurs d'animations/sticky, images cassées.
- **Console** : erreurs, exceptions, requêtes échouées, HTTP ≥ 400 du **clone**. Cible : 0. Une image
  404 ou une font qui ne charge pas se voit ici avant de se voir à l'œil.
- `compare/desktop-side-by-side.png` (original | clone | diff) et les folds du clone dans
  `compare/desktop/` à comparer visuellement avec `screens/desktop/`.

Corrige, relance, jusqu'à A ou jusqu'à ce que l'écart restant soit expliqué (rendu de texte de la
machine, contenu dynamique, vidéo). Trois itérations suffisent en général si l'étape 3 a été faite
sérieusement. Ne conclus jamais sur la seule impression visuelle : c'est le rapport qui dit « fini ».

Vérifie aussi à la main, dans le Browser pane : hover des CTA, ouverture du menu mobile
(`resize_window` mobile), scroll (header qui change de fond ?), pas d'overflow horizontal.

### 6. Livrer

Dans le message final :

- Où est le clone, comment le lancer.
- Le verdict `compare` par viewport et la console (0 erreur, ou lesquelles restent et pourquoi).
- Ce qui **n'est pas** reproduit : formulaires sans backend, auth, widgets tiers, vidéos, contenu
  dynamique, fonts propriétaires remplacées (par quoi).
- La note d'usage des assets (logo/photos/textes appartiennent au site original).

## Références

- `references/fidelity-checklist.md` — les 40 détails qui font qu'un clone paraît faux (charge-la à
  l'étape 2, relis-la avant de livrer).
- `references/rebuild-recipes.md` — recettes prêtes : `@font-face` depuis le manifest,
  IntersectionObserver reveal, header sticky avec changement de fond au scroll, burger menu, marquee
  de logos, accordéon FAQ, carrousel de témoignages, structure statique vs Next.js.
- `references/troubleshooting.md` — site bloqué, page blanche, capture vide, fonts 404, images
  proxifiées, stitching, sites avec smooth-scroll (Lenis) ou scroll horizontal.

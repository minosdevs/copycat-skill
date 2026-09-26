# Rebuild recipes — du manifest au code

Recettes courtes, à adapter aux valeurs **mesurées** dans `manifest.json` / `REPORT.md`. Aucune
valeur ci-dessous n'est à garder telle quelle : ce sont des placeholders.

## Sommaire

1. Structure de projet (statique / Next.js)
2. `@font-face` depuis `design.fonts.faces`
3. Tokens `:root` depuis `design.cssVars` + palette
4. Container & breakpoints
5. Header fixed avec fond au scroll + burger
6. Reveal-on-scroll (IntersectionObserver)
7. Marquee de logos
8. Accordéon FAQ
9. Carrousel / défilement de témoignages
10. Boutons avec hover mesuré
11. Images : tailles rendues, `srcset`, SVG inline
12. Formulaires « front only »
13. Script utilitaire : copier les assets dans le projet

---

## 1. Structure de projet

**Statique (défaut)** — le plus fidèle, zéro build :

```
clone/
├── index.html
├── styles.css          ← tokens + base + composants + sections + responsive, dans cet ordre
├── script.js           ← header scroll, burger, reveal, accordéon, marquee
└── assets/
    ├── fonts/          ← copie de copycat/<host>/assets/fonts
    ├── images/         ← copie de copycat/<host>/assets/images (renommées si besoin)
    ├── svg/
    └── icons/          ← favicons
```

Servir : ajoute dans `.claude/launch.json` une config `{"name":"clone","runtimeExecutable":"npx","runtimeArgs":["serve","clone","-l","4173"],"port":4173}` puis `preview_start` avec `name: "clone"`.

**Next.js (si le repo en est un)** — `app/(clone)/page.tsx` + un composant par section dans
`components/clone/`, fonts via `next/font/local` (pointant vers `public/fonts/`), images via `<Image>`
avec `width/height` = tailles **rendues** × 2 pour le retina, ou `<img>` simple si le rendu exact
compte plus que l'optimisation. Tailwind seulement si le repo l'a déjà ; dans ce cas mets les tokens
dans `@theme` (v4) ou `tailwind.config` (v3) et utilise des valeurs arbitraires (`text-[40px]
leading-[46px] tracking-[-0.8px]`) plutôt que des classes approchantes.

## 2. `@font-face`

Depuis `manifest.design.fonts.faces[]` (une entrée par graisse/style) et les fichiers de
`assets/fonts/` (mappés dans `manifest.assets[]` avec `kind: "fonts"`, l'URL d'origine → `file`) :

```css
@font-face {
  font-family: "aktivGrotesk";            /* faces[i].family, sans les guillemets d'origine */
  src: url("assets/fonts/AktivGroteskCorp_Regular.woff2") format("woff2");
  font-weight: 400;                       /* faces[i].weight — garde les plages "100 900" pour les variables */
  font-style: normal;                     /* faces[i].style */
  font-display: swap;                     /* faces[i].display, sinon swap */
  unicode-range: U+0000-00FF, …;          /* faces[i].unicodeRange si présent (subsets Google) */
}
```

Si `fonts.externalLinks` contient un lien Google Fonts / Typekit : reprends la balise `<link>` telle
quelle (avec `preconnect`). Si la font est absente des assets et non libre (ex. « Söhne », « GT
America », « Aktiv Grotesk » sous licence) : cherche l'équivalent le plus proche sur Google Fonts et
ajuste `size-adjust` si les largeurs diffèrent — puis **note-le dans le livrable**.

`fonts.familiesUsed` dit quelle famille porte réellement le texte (le `body` peut déclarer Geist et
tout le site utiliser autre chose via une classe).

## 3. Tokens

Copie `design.cssVars` en gardant les noms (facilite la lecture du `css/` original) :

```css
:root {
  --color-paper: #f6f6f3;
  --color-ink: #1d1d1b;
  --radius: 12px;
  /* … toutes les variables non `--tw-*` du rapport … */
}
html { font-size: 16px; color-scheme: light; -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--color-paper);          /* design.page.body.background */
  color: var(--color-ink);                 /* design.page.body.color */
  font: 300 16px/24px "aktivGrotesk", system-ui, sans-serif;   /* familiesUsed[0] + typography p */
  -webkit-font-smoothing: antialiased;     /* si présent dans css/ */
}
```

Si les variables sont en `lab()`/`oklch()` (Tailwind v4), garde-les : Chrome/Safari/Firefox les
supportent, et c'est ce que l'original rend.

## 4. Container & breakpoints

```css
.container { width: 100%; max-width: 1440px; margin-inline: auto; padding-inline: 132px; }
@media (max-width: 1439px) { .container { padding-inline: 48px; } }
@media (max-width: 767px)  { .container { padding-inline: 24px; } }
```

Valeurs : `layout.containers[0]` (desktop) et `viewports.tablet/mobile.containers[0]`. Breakpoints :
`layout.breakpoints` — si l'original est en `rem` (`48rem`), reste en `rem`.

## 5. Header fixed + fond au scroll + burger

```html
<header class="site-header" data-scrolled="false">
  <a class="logo" href="/" aria-label="Accueil"><!-- assets/svg/logo-header.svg inline --></a>
  <nav class="nav"><a href="#features">Features</a> …</nav>
  <div class="actions"><a class="btn btn-ghost" href="#">Log in</a><a class="btn btn-primary" href="#">Start for free</a></div>
  <button class="burger" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu"></button>
</header>
```

```css
.site-header { position: fixed; inset: 0 0 auto 0; height: 76px; z-index: 30; display: flex; align-items: center; transition: background-color .2s, box-shadow .2s; }
.site-header[data-scrolled="true"] { background: rgb(246 246 243 / .85); backdrop-filter: blur(12px); box-shadow: 0 1px 0 var(--color-border); }
```

```js
const header = document.querySelector('.site-header');
addEventListener('scroll', () => header.dataset.scrolled = scrollY > 8, { passive: true });
const burger = document.querySelector('.burger');
burger.addEventListener('click', () => { const open = burger.getAttribute('aria-expanded') !== 'true'; burger.setAttribute('aria-expanded', open); document.body.classList.toggle('menu-open', open); });
```

Le rapport dit si le header original change au scroll : compare `nav.background` (au top) avec le
fold 2 de `screens/desktop/` (header masqué) et le hover/`layout.stickies[0].backdropFilter`.

## 6. Reveal-on-scroll

Reproduis l'original : `motion.animatedElements` donne durée/easing/délais ; `css/` contient la
classe (`.nb-apparition`, `.reveal`, `[data-aos]`…).

```css
.reveal { opacity: 0; transform: translateY(16px); transition: opacity .62s cubic-bezier(.16,1,.3,1), transform .62s cubic-bezier(.16,1,.3,1); }
.reveal.is-visible { opacity: 1; transform: none; }
.reveal[data-delay="1"] { transition-delay: .08s } .reveal[data-delay="2"] { transition-delay: .16s }
@media (prefers-reduced-motion: reduce) { .reveal { opacity: 1; transform: none; transition: none; } }
```

```js
const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
```

Sans JS, tout doit rester visible (`<noscript>` ou classe `js` sur `<html>`).

## 7. Marquee de logos

```css
.marquee { overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
.marquee__track { display: flex; gap: 64px; width: max-content; animation: marquee 30s linear infinite; }
.marquee:hover .marquee__track { animation-play-state: paused; }
@keyframes marquee { to { transform: translateX(-50%); } }
```

Duplique la liste de logos deux fois dans le track. Vitesse : regarde `motion.keyframes` et la durée
dans `css/`.

## 8. Accordéon FAQ

```html
<details class="faq" name="faq"><summary>Does the AI write instead of me?<span class="faq__icon"></span></summary><div class="faq__body"><p>…</p></div></details>
```

`name="faq"` ferme les autres automatiquement (Chrome 120+, Safari 17.2+). Pour l'animation de
hauteur, `interpolate-size: allow-keywords` + `transition: height` ou un `grid-template-rows: 0fr →
1fr`. Icône `+` → `−` via `details[open] .faq__icon`.

## 9. Témoignages / carrousel

Si l'original défile automatiquement (`motion.keyframes` contient un nom type `*-defilement*`,
`*-scroll*`, ou `Swiper` détecté) : colonnes qui translatent verticalement en boucle
(`@keyframes` avec `translateY(-50%)` et liste dupliquée), pause au hover. Sinon grille `masonry`
approchée avec `columns: 3; column-gap: 24px` et `break-inside: avoid`.

## 10. Boutons

Depuis la table « Buttons / CTAs » + « Hover states » :

```css
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 20px; border-radius: 9999px; font: 500 14px/1 "aktivGrotesk"; letter-spacing: -0.28px; text-decoration: none; cursor: pointer; transition: transform .22s cubic-bezier(.16,1,.3,1), background-color .15s, color .15s, border-color .15s, box-shadow .22s; }
.btn-primary { background: #fcff55; color: #1d1d1b; border: 1px solid #ebef0f; }
.btn-primary:hover { background: #1d1d1b; color: #f6f6f3; border-color: #1d1d1b; box-shadow: 0 6px 18px -8px rgb(29 29 27 / .32); transform: translateY(-1px); }
```

Chaque valeur vient de `hover[i].changed` (`before → after`) et de `ctas[i].style`.

## 11. Images

- `renderedWidth × renderedHeight` du rapport = les dimensions à donner à `<img width height>`
  (évite le layout shift) ; `object-fit` et `border-radius` idem.
- Un `srcset` original en 8 tailles → garde la plus grande téléchargée (`assets/images/*-w1920.*`)
  et laisse le navigateur redimensionner, ou régénère 2 tailles avec `sharp` si le poids compte.
- SVG inline (`media.inlineSvgs`, fichiers `assets/svg/inline-NN*.svg`) → colle le markup dans le
  HTML pour garder `currentColor` et les hovers.
- Images de fond CSS (`media.backgroundImages`) → `background: url() center/cover`.
- Vidéos (`media.videos`) : `autoplay muted loop playsinline` + `poster` ; si `--videos` n'a pas été
  passé, mets le poster seul et signale-le.

## 12. Formulaires

Reproduis le visuel (`design.forms[]` : champs, placeholders, `required`, texte du submit). Empêche
l'envoi et affiche l'état « succès » de l'original si visible, sinon un simple message :

```js
form.addEventListener('submit', (e) => { e.preventDefault(); form.dataset.state = 'sent'; });
```

Dis dans le livrable que le formulaire n'envoie rien.

## 13. Copier les assets dans le projet

```bash
node -e '
const fs=require("fs"),p=require("path");const m=require(process.argv[1]+"/manifest.json");
const dst=process.argv[2];
for(const a of m.assets.filter(a=>a.file)){const to=p.join(dst,a.file.replace(/^assets\//,""));fs.mkdirSync(p.dirname(to),{recursive:true});fs.copyFileSync(p.join(process.argv[1],a.file),to);}
console.log("copied",m.assets.filter(a=>a.file).length,"files to",dst);
' copycat/exemple.com clone/assets
```

Puis remplace dans le HTML chaque URL d'origine par son `file` local : la correspondance
`url → file` est dans `manifest.assets[]` (les `_next/image?url=…&w=…` sont nommés
`<source>-w<width>.<ext>`).

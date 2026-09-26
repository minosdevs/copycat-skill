# Fidelity checklist — ce qui trahit un clone

À relire à l'étape 2 (avant de coder) et avant de livrer. Chaque ligne est un écart qu'un œil
entraîné voit en moins d'une seconde. Le rapport de `compare.mjs` en attrape la moitié ; l'autre
moitié, c'est toi.

## Typographie (le n°1 des clones ratés)

- [ ] **Même famille**, et même **graisse** par élément. Un 500 remplacé par 600 se voit. Source :
      table « Typography » (colonne weight) + `design.typography.top`.
- [ ] **Fallback fidèle** : si la font est propriétaire et introuvable, choisis une alternative de même
      largeur de glyphe (ex. Inter ↔ SF Pro, Söhne ↔ Inter Tight, GT America ↔ Public Sans) et
      **signale-le**. Vérifie que le titre tient sur le **même nombre de lignes** que sur l'original.
- [ ] `font-size`, `line-height` (en px, pas « normal »), `letter-spacing` (négatif sur les gros
      titres, très courant : `-0.02em`…), `text-transform`, `font-feature-settings` si présents dans
      `css/`.
- [ ] `-webkit-font-smoothing: antialiased` si le CSS original l'a (change l'épaisseur perçue).
- [ ] `text-wrap: balance` / `pretty` sur les titres si présents dans le CSS.
- [ ] Largeur maximale des paragraphes (`max-width: 60ch`, `672px`…) — sinon les lignes ne coupent
      pas au même endroit.

## Couleurs & surfaces

- [ ] Fond `body`/`html` exact (`#f6f6f3` ≠ `#ffffff`). Un « blanc cassé » remplacé par du blanc pur
      est la 2e erreur la plus fréquente.
- [ ] Couleur de texte principale et secondaire (souvent un gris chaud/froid précis, pas `#666`).
- [ ] Couleurs de **bordure** (`#e5e7eb` vs `#d8d8d8`), opacités (`rgba(...)` @ 60 %).
- [ ] Gradients : reprends la chaîne exacte de « Gradients » (angle, stops, `in oklab`).
- [ ] Ombres : chaîne exacte de « Shadows » (souvent 2–3 couches empilées).
- [ ] `border-radius` par composant (cartes ≠ boutons ≠ inputs ; la valeur pill = `9999px`).
- [ ] Images `object-fit`, ratio, `border-radius`, et **taille rendue** (pas naturelle).

## Layout & espacements

- [ ] `max-width` du container et `padding-x` aux 3 viewports.
- [ ] Rythme vertical : padding haut/bas des sections (souvent 96/120/160 px desktop, moitié mobile).
- [ ] Gaps de grille exacts (`gap: 24px` ≠ `gap: 32px`).
- [ ] Hauteur du header et **offset du contenu** sous un header fixed.
- [ ] Alignement : centré vs aligné à gauche par section (regarde le crop, pas ton intuition).
- [ ] Largeurs de colonnes asymétriques (`1fr 1.2fr`, `5/12 – 7/12`) — `dom-outline.txt` donne les
      `[WxH]` réels.
- [ ] Hauteur totale de la page à ±2 % par viewport (le rapport compare donne `height Δ`).
- [ ] Pas d'**overflow horizontal** sur mobile (vérifie `document.documentElement.scrollWidth`).

## Header / navigation

- [ ] `position` (`fixed`/`sticky`), fond (transparent au top → plein au scroll ?), `backdrop-filter`,
      bordure basse, z-index.
- [ ] Logo à la **taille rendue** (`nav.logo.w × h`), SVG inline si l'original l'est.
- [ ] Ordre, libellés et espacement des liens ; état actif.
- [ ] Mobile : burger + panneau (plein écran ? drawer ?), animation d'ouverture.
- [ ] CTA du header avec son hover.

## Boutons & interactions

- [ ] Padding, hauteur, radius, bordure, ombre, graisse **par variante** (primaire, secondaire, ghost).
- [ ] **Hover** : reprends `hover[].changed` (couleur, fond, `transform: translateY(-1px)`, ombre,
      opacité) et la durée/easing de la transition la plus fréquente.
- [ ] `cursor: pointer` sur ce qui est cliquable.
- [ ] Focus visible (outline/ring) — copie celui du CSS original s'il en a un.
- [ ] Liens : soulignement (`text-decoration`, `text-underline-offset`), couleur au hover.

## Motion

- [ ] Reveal-on-scroll : mêmes éléments concernés, même translation (12–24 px), durée, easing
      (`cubic-bezier(.16,1,.3,1)` est le plus courant), **délais en cascade**.
- [ ] Animations d'entrée du hero (mots qui apparaissent un à un, etc.) — `design.motion.animatedElements`.
- [ ] Boucles : marquee de logos (vitesse, pause au hover), carrousel auto (intervalle), pulsations.
- [ ] Header qui change au scroll, progress bar, parallax léger sur le hero.
- [ ] `prefers-reduced-motion` respecté si l'original le fait.
- [ ] Rien ne « saute » au chargement (fonts `font-display: swap` → réserve avec `size-adjust` ou
      même fallback que l'original).

## Contenu

- [ ] Texte **copié** depuis `content/text.md`, pas retapé (apostrophes ’, espaces insécables, …).
- [ ] Hiérarchie sémantique identique (`h1` unique, `h2` par section, `nav`, `main`, `footer`).
- [ ] Toutes les images présentes, `alt` repris, bonnes tailles (pas une 400 px étirée à 1200).
- [ ] Icônes : les SVG inline de `assets/svg/`, pas une lib d'icônes « proche ».
- [ ] Footer complet : colonnes, liens, mentions, réseaux, copyright.
- [ ] Favicon, `<title>`, meta description, `og:image`, `lang`.

## Responsive

- [ ] Mêmes **breakpoints** (valeurs et unité : `48rem` ≠ `768px` si le root font-size change).
- [ ] Ordre des blocs en mobile (image au-dessus ou en-dessous du texte ?) — fold mobile.
- [ ] Tailles de titres mobile (souvent 32–40 px vs 56–72 px desktop).
- [ ] Grilles : 3 → 2 → 1 colonnes aux bons seuils.
- [ ] Éléments cachés/affichés selon le viewport (`nav.visibleLinks` par viewport dans le rapport).

## Technique

- [ ] Console du clone : **0** erreur, 0 requête échouée, 0 404 (fonts et images incluses).
- [ ] Pas de flash de contenu non stylé ; pas de layout shift au chargement.
- [ ] Fonts servies en `woff2` local avec les bons `unicode-range` si l'original en a.
- [ ] Assets renommés lisiblement, pas de `image-3f2a1b.png` dans le code final si évitable.
- [ ] Le clone tourne à la racine attendue (`/`), les liens internes pointent vers des routes du clone
      (ou `#`), pas vers le site original.

## Avant de dire « fini »

- [ ] `compare.mjs` : grade A (< 2 %) ou B avec écart expliqué ; console 0.
- [ ] Side-by-side regardé **fold par fold** sur desktop et mobile.
- [ ] Hover testé à la main sur 3 éléments, menu mobile ouvert/fermé.
- [ ] Liste honnête de ce qui n'est pas reproduit.

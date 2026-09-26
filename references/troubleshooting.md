# Troubleshooting — quand la capture ou la comparaison déraille

## La capture

**`Cannot find package 'playwright'`** — les dépendances ne sont pas installées dans `scripts/` :
`cd <skill>/scripts && npm install && npx playwright install chromium`. Lance toujours les scripts
avec leur chemin complet (`node <skill>/scripts/capture.mjs …`), ils résolvent leurs deps depuis leur
propre dossier.

**Page blanche / 403 / « Just a moment… » (Cloudflare, Vercel bot protection, Akamai)** — le headless
est détecté. Dans l'ordre : `--channel chrome` (ou `--channel msedge`) pour lancer le **vrai** Chrome
installé en headless au lieu du Chromium de Playwright — ça passe Cloudflare dans la grande majorité
des cas et c'est ce qu'il faut essayer en premier ; puis `--headed` (fenêtre visible, ne marche pas
depuis un shell sandboxé), `--wait 5000`, puis le
plan B manuel : ouvre l'URL dans le Browser pane (`preview_start {url}`), screenshots avec `computer`
fold par fold (`scroll` puis `screenshot`), et `javascript_tool` avec le contenu de
`extract.browser.js` suivi de `JSON.stringify(__copycatExtract())` → écris le résultat dans
`manifest.json` à la main sous `design`. Les CSS se récupèrent avec `read_network_requests` (filtre
`.css`) → `requestId` → body.

**Le site demande un login / est derrière un paywall** — copycat ne saisit jamais d'identifiants.
Demande à l'utilisateur d'exporter la page depuis son navigateur (Ctrl+S « page complète ») ou de
capturer lui-même avec la console (`extract.browser.js`), puis travaille sur ces fichiers.

**Le `REPORT.md` dit `native full-page had N% flat rows … stitched version`** — normal sur les sites
à reveal-on-scroll : la capture native de Chromium ne déclenche pas les IntersectionObserver, le
script a choisi le stitching des folds. Rien à faire. Les folds restent la référence.

**Les folds montrent tous le haut de page** — le site scrolle dans un conteneur interne (`<main
style="overflow:auto">`, Lenis/Locomotive en mode `wrapper`) ou un scroll-lock est actif. Vérifie
dans le Browser pane : `document.scrollingElement`, et cherche l'élément avec `overflow:auto` +
`scrollHeight` élevé. Contournement rapide : `--headed` et, si c'est un smooth-scroll JS, ajoute
`--wait 1500`. Si ça persiste, capture à la main (voir ci-dessus) en scrollant le bon conteneur :
`document.querySelector('<sel>').scrollTo(0, y)`.

**Sections vides ou en opacité 0 dans les crops** — l'animation d'entrée dure plus de 0,7 s ou ne se
déclenche qu'au scroll « humain ». Relance avec `--wait 2000` ; sinon lis les folds (délai plus long)
et le CSS de la classe de reveal dans `css/` pour connaître l'état final.

**Fonts en 404 dans `manifest.assets`** — la `src` du `@font-face` était relative à un CSS
cross-origin non lisible. Ouvre le CSS dans `css/`, cherche `@font-face`, reconstruis l'URL absolue à
partir de `manifest.css[i].href` et télécharge à la main (`curl -o`). Si la font vient d'un CDN
sous licence (Typekit, fonts.com), elle n'est pas téléchargeable : choisis une alternative et dis-le.

**Images nommées `image.png`, `image-1a2b3c.png`** — proxy d'images non reconnu. Regarde
`manifest.assets[i].url` pour retrouver la source et renomme. Les `_next/image`, `?url=`, `?src=`
sont déjà gérés.

**`page.screenshot: Timeout 30000ms exceeded` sur le premier fold** — c'est presque toujours une page
de blocage anti-bot (le screenshot attend des fonts/animations qui n'arrivent jamais). Vérifie avec
`--channel chrome` avant de chercher ailleurs ; le timeout des folds est à 120 s.

**Capture très longue (> 4 min)** — page très haute ou lourde. `--viewports desktop,mobile`,
`--no-hover`, `--no-assets` pour un premier passage rapide, puis une deuxième capture complète
pendant que tu construis les fondations.

**`section N crop failed`** — section plus haute que 8000 px ou hors du viewport ; utilise les folds.

**Sites en scroll horizontal / one-page à panneaux** — les folds verticaux ne suffisent pas.
Capture à la main dans le Browser pane en scrollant le conteneur horizontal, et note la mécanique
(GSAP ScrollTrigger `pin`, `scroll-snap-type: x`) depuis `css/` et `tech.detected`.

**Mode sombre** — `--dark` capture avec `prefers-color-scheme: dark`. Si le site a un toggle par
classe (`page.hasDarkClassToggle`), capture les deux : deux dossiers `--out`.

**Bannière cookies encore visible** — son sélecteur n'est pas dans la liste. Elle est masquée en
CSS (pas acceptée), donc sans conséquence légale ; ajoute son id/classe dans `hideConsentOverlays`
(`lib.mjs`) si elle gêne les screens.

## La comparaison

**Mismatch > 20 % alors que « ça ressemble »** — presque toujours une différence de **hauteur**
(`height Δ`) : dès qu'une section est plus haute de 40 px, tout ce qui suit est décalé et compte comme
différent. Corrige la première « worst zone », relance. `mismatchPercentOverlapOnly` donne l'écart
sans le décalage de queue.

**Écart de 1–3 % irréductible** — anti-aliasing du texte, compression JPEG/WebP différente, animation
infinie (ciel qui dérive, carrousel auto) figée à un instant différent. C'est un A. Regarde le
`side-by-side` pour confirmer que rien de structurel ne reste.

**`method: stitched` sur l'original mais le clone n'a pas de reveal-on-scroll** — sans conséquence,
la méthode est appliquée aux deux ; les hauteurs restent comparables.

**Fonts « missing » alors qu'elles sont chargées** — nom de famille différent (`aktivGrotesk` vs
`Aktiv Grotesk`). La comparaison normalise casse/espaces, pas les renommages : aligne le
`font-family` sur celui de l'original, c'est gratuit et ça rend `css/` réutilisable.

**Console du clone : `Failed to load resource 404`** sur `/favicon.ico`, une font, une image — c'est
exactement ce que le rapport doit attraper. Corrige le chemin, ne masque pas.

**`compare` se termine sur `navigation failed`** — le serveur du clone n'écoute pas sur l'URL donnée,
ou il faut `http://` (pas `https://`) en local.

## Les limites connues

- Contenu derrière interaction (onglets, modales, étapes de formulaire) : non capturé
  automatiquement. Ouvre-les dans le Browser pane et screenshot à la main, ou ajoute un
  `page.click()` ciblé dans une copie locale de `capture.mjs`.
- Canvas / WebGL / Lottie : capturés en image figée, la mécanique doit être réécrite (ou remplacée
  par une vidéo/poster) — signale-le.
- Contenu personnalisé (géoloc, A/B tests, cookies) : la capture reflète une seule variante.
- Sites très dynamiques (prix, stocks, feeds) : les textes de `content/text.md` datent de la capture.

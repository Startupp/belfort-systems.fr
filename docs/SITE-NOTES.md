# Site public belfort-systems.fr — notes de refonte (octobre 2026)

## Ce qui a changé

- **`index.html`** réécrit pour les clients, plus un CV : en-tête avec téléphone cliquable (`tel:+33609897443`) et bouton « Demander un rendez-vous » → hero (H1 « Dépannage et infogérance informatique pour les petites structures dans les Yvelines », 3 preuves, carte Château de Breteuil) → Pour qui (4 cibles) → Services (4 cartes, prix du catalogue) → Formules (3 forfaits + site WordPress, « à partir de », mention HT / TVA non applicable) → Simulateur → Étude de cas Breteuil (17 boîtes, 1 soirée, 20 guides) → Comment ça se passe (4 étapes) → FAQ (6 questions, `FAQPage`) → Contact + calendrier → pied de page avec mentions légales complètes (adresse, SIRET, APE, art. 293 B, hébergeur GitHub Pages) et lien « Qui suis-je ». Sections Expertise / Parcours supprimées. Bouton flottant « Espace client » et lien discret `/ecorce/` (dans `app.js`) conservés.
- **`qui-suis-je/index.html`** (nouveau) : page courte et chaleureuse, sans employeur ni diplôme ; portrait `assets/portrait.jpg` avec repli automatique sur un médaillon « D » (`onerror`) ; 3 principes ; « ce que je ne fais pas » ; appel vers le formulaire. JSON-LD `ProfilePage` + `Person` + fil d'Ariane.
- **`assets/style.css`** : refonte complète (même charte #2E2760, Spectral + Archivo). Polices désormais **hébergées en local** dans `assets/fonts/` (woff2 latin, licence OFL jointe, `font-display: swap`, `preload` des deux fichiers critiques) : plus aucun appel à Google Fonts sur les pages publiques. Grilles en `minmax(0,1fr)` : aucun défilement horizontal à 380 px.
- **`assets/site.js`** (nouveau) :
  - lit `assets/catalogue.json` et remplace tous les `[data-prix]` de la page (les valeurs écrites dans le HTML sont un repli sans JS, identiques au catalogue du 2026-10-11 ; si le JSON change, la page suit automatiquement) ;
  - simulateur en 4 questions → forfait ou prestation ponctuelle, prix estimé, explication, bouton « Recevoir cette estimation par e-mail » qui pré-remplit `formule`, `sujet` et le message du formulaire ; toujours « Estimation, hors taxes, prix à confirmer sur devis » ;
  - formulaire de contact : validation côté client, pot-de-miel `website`, horodatage `t`, `creneau`, envoi `fetch` POST `BS_API + "/contact"` (JSON) ; sur 400/422/429 affiche l'erreur de l'API ; sur échec réseau / 5xx / délai 10 s → « Le service est momentanément indisponible » + bouton mailto prérempli avec tout le contenu saisi ;
  - calendrier : bouton « Voir les disponibilités » charge `BS_API + "/disponibilites?semaine=AAAA-WW"` (semaine ISO), affiche lundi-vendredi, créneaux 9-10-11 h et 14-15-16-17 h, navigation semaine précédente/suivante (pas avant la semaine courante), créneaux passés grisés, créneau choisi ajouté au champ caché `creneau` et à la fin du message ; si l'API ne répond pas → « Proposez vos disponibilités dans le message ».
  - Formats de réponse acceptés pour `/disponibilites` (au choix, à aligner avec le Worker) : `{ok:true, creneaux:[{debut:"2026-10-13T09:00", fin:"…"}]}` ou `{creneaux:["2026-10-13T09:00", …]}` ou `{jours:[{date:"2026-10-13", creneaux:["09:00","10:00"]}]}` ou un simple tableau. Les créneaux non listés sont affichés désactivés.
- **`assets/app.js`** : menu mobile fermé par Échap et par clic à l'extérieur.
- **SEO** : `<title>` 49 caractères avec le lieu, description 154, un seul H1 par page, Open Graph / Twitter conservés, JSON-LD `LocalBusiness` + `ProfessionalService` complet (adresse, geo 48.7173 / 2.1039, areaServed Yvelines + 6 communes, téléphone, priceRange, horaires, fondateur `Person`, logo `icon-512.png`, catalogue d'offres), `FAQPage` identique aux 6 questions affichées, `WebSite`. `sitemap.xml` avec les deux vraies pages et `lastmod`. `robots.txt` : `/portail/` et `/haccp/` ajoutés en Disallow. `404.html` alignée (sans Google Fonts, téléphone, deux boutons).
- **Icônes** : `assets/icon-512.png`, `assets/icon-192.png`, `assets/favicon-32.png` générées depuis `favicon.svg` (Chromium headless).
- **Accessibilité** : lien d'évitement, `aria-label` sur la navigation, `aria-expanded`/`aria-controls` sur le bouton de menu, `aria-current` sur la page active, `aria-live` sur le résultat du simulateur et l'état du formulaire, `aria-pressed` sur les créneaux, labels explicites sur tous les champs, focus visible partout, contrastes relevés (`--muted` passé à #4F4D66).

## Vérifié (Playwright / Chromium, serveur local)

- `/`, `/qui-suis-je/`, `/404.html` à 380 et 1280 px : zéro erreur console (hors ressources attendues : API injoignable en local, `portrait.jpg` absent), `scrollWidth == clientWidth` partout.
- Simulateur : résultat pour 3 combinaisons (ponctuel 35 € HT/h ; Tranquillité 90 + site 120 = 210 € HT/mois + migration 390 € une fois ; Sérénité 160 € HT/mois, site inclus) ; le bouton pré-remplit bien le champ `formule`.
- Formulaire : API injoignable → message de repli + lien `mailto:` prérempli, sans erreur JS.
- Calendrier : API injoignable → message de repli.
- Menu mobile : ouverture, fermeture par Échap. Médaillon de repli sur la page Qui suis-je.
- JSON-LD des deux pages analysé avec `json.loads` ; questions `FAQPage` strictement identiques aux `<summary>`.

## Pas vérifié

- Le chemin « succès » du formulaire et du calendrier (le Worker `belfort-api` n'est pas déployé / pas joignable depuis l'environnement de test). Le format de réponse de `/disponibilites` doit être confirmé côté API (voir formats acceptés ci-dessus).
- Rendu réel sur iOS Safari / Android (seulement Chromium).

## Ce qui reste à faire

1. **Turnstile** : `window.BS_TURNSTILE` est vide dans `assets/config.js`. Quand la clé publique existe : charger `https://challenges.cloudflare.com/turnstile/v0/api.js` uniquement si la clé est non vide, insérer le widget avant le bouton d'envoi, et transmettre `cf-turnstile-response` dans le JSON. Le Worker devra vérifier le jeton.
2. **Photo** : déposer `assets/portrait.jpg` (carré, ≥ 440 px, < 80 Ko) ; le médaillon disparaît automatiquement.
3. **Polices** : le sous-ensemble latin couvre le français (accents, œ, €). Les autres pages (`portail/`, `admin/`, `clients/`) appellent encore Google Fonts : à basculer sur `assets/fonts/` quand on y touche.
4. **`README.md`** indique encore « CV en ligne » pour `/` : à mettre à jour (hors périmètre de cette refonte).
5. **Image Open Graph** : `assets/og-cover.png` porte encore l'ancienne accroche « gérée comme un service IT interne » ; à regénérer avec la nouvelle promesse.

## 5 idées SEO suivantes

1. **Pages locales** : une page par commune-clé (« Dépannage informatique à Versailles », Saint-Quentin-en-Yvelines, Rambouillet, Chevreuse) avec un contenu réellement différent (temps de trajet, exemples de structures locales), reliées depuis le pied de page.
2. **Fiche Google Business Profile** « Belfort Systems » (catégorie : Service de dépannage informatique, zone desservie sans adresse publique si souhaité) + demander un avis au Château de Breteuil ; ajouter l'URL de la fiche dans `sameAs` du JSON-LD.
3. **Étude de cas détaillée** `/references/chateau-de-breteuil/` (avant / après, chiffres, citation de Pauline ou François de Breteuil avec leur accord) et une courte page « Migration Microsoft 365 pour associations et TPE » ciblant cette requête.
4. **Guides publics** : publier 3 ou 4 guides d'une page (ex. « Partager un agenda dans Outlook », « Que faire quand un poste est lent ») en `/guides/` — contenu utile, mots-clés longue traîne, preuve de pédagogie.
5. **Mesure et maillage** : Search Console (sitemap soumis), suivi des requêtes locales ; ancre interne cohérente (« dépannage informatique Yvelines ») depuis les pages clients et le portail, et inscription sur 2 ou 3 annuaires locaux fiables (CCI Versailles-Yvelines, mairie de Magny-les-Hameaux, Pages Jaunes) avec exactement les mêmes nom / adresse / téléphone.

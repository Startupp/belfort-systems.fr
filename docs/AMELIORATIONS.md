# Fiche des améliorations à prévoir — belfort-systems.fr

Mise à jour : 11 octobre 2026. Classement par priorité ; « Qui » dit si Damien doit agir lui-même.

## Sécurité des données clients

| Priorité | Amélioration | Qui |
|---|---|---|
| 1 | Créer les 3 secrets GitHub (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSWORD` : 16 caractères minimum, phrase de passe) puis lancer le workflow « Déployer le service » avec `schema` et `seed` cochés une seule fois. | Damien |
| 1 | Brancher Turnstile (anti-robots) sur le formulaire de contact : clé publique dans `assets/config.js`, vérification du jeton dans le Worker (`/contact`). | Claude, dès que la clé existe |
| 1 | Corriger le portail client : il écrit `bsv:chateau-de-breteuil` et les pages lisent `bsv:breteuil` (le client retape son mot de passe). | Claude |
| 2 | Sauvegarde automatique de la base D1 (export hebdomadaire vers R2 par un Worker planifié) et procédure de restauration testée. | Claude |
| 2 | Journal d'audit : purge au-delà de 12 mois, export CSV depuis le panneau. | Claude |
| 2 | Deuxième facteur sur le panneau (clé d'accès WebAuthn ou code TOTP) une fois le mot de passe en place. | Claude |
| 2 | Contrat de sous-traitance RGPD (art. 28) et clause de confidentialité à joindre aux devis ; registre des traitements (voir `cadre-legal-2026.md`). | Damien avec un modèle de Claude |
| 3 | Pages clients chiffrées : passer les 5 documents Breteuil (750 Ko chacun) sur `bsv.js` commun et les régénérer plus légers. | Claude |
| 3 | En-têtes de sécurité du site (CSP, Referrer-Policy) : GitHub Pages ne les permet pas ; prévoir le passage du site sur Cloudflare Pages si besoin. | à décider |

## Référencement (SEO)

1. Fiche Google Business Profile « Belfort Systems » à Magny-les-Hameaux (catégorie : service de réparation informatique), même adresse, même téléphone que le site — le levier local le plus fort. (Damien)
2. Une page par service (`/depannage-informatique-yvelines/`, `/migration-microsoft-365/`, `/gestion-site-wordpress/`) avec le même gabarit que « Qui suis-je ». (Claude)
3. Une page par commune ciblée (Versailles, Saint-Quentin-en-Yvelines, Rambouillet, Chevreuse) seulement si le contenu est réellement différent — sinon s'abstenir. (Claude)
4. Avis clients : demander un avis Google au Château après la facture ; l'afficher sur le site avec le balisage `Review`. (Damien)
5. Regénérer `assets/og-cover.png` avec la nouvelle accroche et mettre `README.md` à jour (il dit encore « CV en ligne »). (Claude)
6. Déclarer le site dans Google Search Console et Bing Webmaster Tools, envoyer `sitemap.xml`. (Damien)

## Design

- Photo de Damien : déposer `assets/portrait.jpg` (carré, ≥ 440 px, < 80 Ko) ; la page « Qui suis-je » l'affiche automatiquement. La photo du compte Google n'est pas accessible depuis les connecteurs actuels (Drive ne la contient pas) : l'exporter depuis myaccount.google.com ou en joindre une ici.
- Visuels : illustrations légères par section (icônes linéaires déjà en place) ; une image réelle d'intervention ou du château (avec accord) vaudrait mieux qu'un visuel généré.
- Panneau privé : passer `portail/`, `admin/` et `clients/` sur les polices locales (`assets/fonts/`) pour supprimer Google Fonts partout.
- Thème sombre du site public (le panneau l'a déjà).

## Fonctions à venir (tableau de bord)

- Éditeur de contenu en direct : les textes et prix de l'accueil lus depuis l'API (table `contenus`), modifiables depuis le panneau avec aperçu avant publication ; repli statique si l'API est injoignable.
- Envoi réel des e-mails (factures, réponses) depuis le Worker via un service d'envoi (Resend ou Brevo, domaine à authentifier) au lieu du `mailto:`.
- Facturation électronique 2027 : export Factur-X depuis le panneau et choix d'une plateforme agréée (voir `cadre-legal-2026.md`).
- Rendez-vous : synchronisation avec l'agenda de Damien (Google Calendar) pour bloquer les créneaux déjà pris.
- Application Breteuil reliée au vrai service : `/client/*` avec le jeton du client, pour que les demandes du château arrivent dans le panneau.

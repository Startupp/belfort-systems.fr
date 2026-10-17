# Tableau de bord `/admin/` — notes pour l'agent API et la suite

Fichiers : `admin/index.html`, `admin/admin.css` (autonome), `admin/admin.js`, `admin/apercu/*.json` (données d'exemple, lecture seule).
L'ancien outil « Espaces chiffrés » est conservé tel quel : l'onglet charge `assets/bsv.js` + `assets/admin.js` sans modification (ses éléments `#p-spaces`, `#list`, `.tab`… sont dans `#ecran-espaces`).

## Ce qui dépend de l'API (contrat `docs/TABLEAU-DE-BORD.md`)

Détection : au chargement, `GET /admin/resume` sans jeton (4 s max). Toute réponse HTTP (même 401) = service joignable ; erreur réseau = mode aperçu (bandeau jaune, `admin/apercu/*.json`, aucune écriture).

Routes appelées et **forme de réponse** (confirmées côté Worker, voir `api/NOTES.md` ; vérifiées par `api/test/local.mjs`) :

| Appel | Réponse attendue par le panneau |
|---|---|
| `POST /admin/login {password}` | `{token, exp}` ; 401 = mot de passe refusé ; 429 = `Retry-After` lu pour le message d'attente |
| `GET /admin/resume` | `{contacts_nouveaux, demandes_a_traiter, factures_en_attente, prochain_rdv:{debut,fin,avec,statut}, dernier_evenement:{date,titre}}` |
| `GET /admin/journal?limit=10` | `{journal:[{id, quand, qui, action, cible, table}]}` (`table` facultatif, affiché en étiquette) |
| `GET /admin/contacts` | `{contacts:[…]}` ; chaque contact peut porter `rdv:{id,debut,fin,statut,note}` (jointure `rdv.contact_id`) |
| `PATCH /admin/contacts/:id {statut}` | `{ok:true}` |
| `PATCH /admin/rdv/:id {statut:"confirme"}` | `{ok:true}` ; statuts `propose|confirme|annule` (route ajoutée au Worker) |
| `GET /admin/projets` | `{projets:[{…projet, client:{nom,…}, compteurs:{statut:n}, nb_demandes}]}` |
| `GET /admin/projets/:id` | `{projet:{…, client:{id,slug,nom,contact,email}}, demandes:[…], evenements:[…], conversations:[{…, messages:[…]}], fichiers:[…]}` — voir `admin/apercu/projet-exemple.json` pour la forme exacte |
| `POST/PATCH /admin/projets` | champs `client_id, titre, resume, statut` |
| `PATCH /admin/demandes/:id` | corps `{action:"traiter"|"fait"|"abandonner"|"rouvrir", statut, solution, motif, reste, note}` ; l'UI envoie aussi `statut` cible pour lever toute ambiguïté. Champs supplémentaires utilisés : `note` (texte libre cumulé), `encore` (nombre de « ça ne marche toujours pas », alimenté par `/client/demandes/:id/encore`), `encore_le` (date du dernier signalement) |
| `POST /admin/demandes` | `{projet_id, titre, groupe, qui, tarif, reste, statut:"nouveau", date_txt}` |
| `POST/PATCH/DELETE /admin/evenements[/:id]` | `{projet_id, date ("" = à venir), type, titre, detail}` |
| `POST /admin/conversations` → `{id}` ; `POST /admin/messages` | `{conversation_id, demande_id|null, de, date, texte, piece|null}` |
| `POST /admin/fichiers` ; `DELETE /admin/fichiers/:id` | `{projet_id, nom, url, type, taille|null, note}` |
| `GET /admin/factures` | `{factures:[{id, numero|null, client_id, client_nom, client_contact?, client_email?, date, echeance, lignes:[{ref,designation,quantite,unite,prix}], total_ht, tva:0, statut, note, type?:"avoir", reference?}]}` (jointure `clients` faite par le Worker) |
| `POST /admin/factures` → `{id}` ; `PATCH /admin/factures/:id` | brouillon seulement ; `POST …/emettre` attribue le numéro ; `POST …/payee {date_paiement}` |
| `GET /admin/clients` | `{clients:[{id, slug, nom, contact, email, cree, projets}]}` ; `POST` → `{id, token}` (clair, une fois) ; `POST /:id/regenerer` → `{token}` |
| `GET /admin/flux` (SSE) | **le jeton est passé en `?t=<jeton>`** car `EventSource` ne peut pas envoyer d'en-tête `Authorization` : le Worker doit accepter `?t=` en plus de Bearer sur cette route. Événement nommé `maj` (`event: maj`), données `{table,id,quand}`. Repli : rafraîchissement toutes les 15 s si la connexion échoue |

Comportement commun : 401 → jeton effacé, retour à l'écran de connexion ; 429 → message d'attente ; `{ok:false, erreur}` affiché tel quel dans le dialogue.

## Choix faits dans les données d'exemple (`admin/apercu/`)

- Conversion des `api/seed` : statuts `fait→traite`, `afaire→lu` (sauf celles du Word du 06/10 → `nouveau`), `aconfirmer→en_cours`, `partiel→partiel`, `attente→repondu` ; tarifs `hors→extra` ; canaux `Sur site→Sur place`, `Teams→Téléphone`, `Word`/`Guide`→ `Mail` avec `piece` ; types d'événements `jalon→decision`, `incident→echange`, `avenir→decision` avec date vide (affiché « À venir »).
- `api/seed/importer.mjs` applique la même table : l’aperçu et la base coïncident (16 traitées, 7 en cours, 17 lues, 7 partielles, 1 nouvelle, 1 répondue ; 5 conversations).
- La facture « envoyée » d'exemple est à 0 € (« 000,00 € (exemple) ») et numérotée `BS-2026-000` : fictive.

## Reste à faire

- Avoir : `POST /admin/factures {type:"avoir", reference:"BS-AAAA-NNN", lignes}` crée le brouillon lié (lignes mises en négatif par le Worker) ; numéroté à l’émission, la facture d’origine passe alors `annulee`. Le Worker propose aussi `POST /admin/factures/:id/avoir {motif}`.
- « Convertir en projet » enchaîne `POST /admin/clients` puis `POST /admin/projets` : l'API pourrait proposer une route unique.
- Le PDF passe par l'impression du navigateur (`@page A4`, zone `#impression` seule) ; pas de génération serveur.
- Turnstile : rien côté admin.
- Supprimer `admin/shots/` si des captures traînent (elles ne servent qu'aux tests Playwright).

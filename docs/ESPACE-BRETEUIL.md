# Espace Breteuil — application publique (V1)

> Document en cours de rédaction (branche `feat/espace-breteuil-v1`).

## Choix du chemin

L'application est servie sous **`/espace-breteuil/`**.

Le dossier `clients/chateau-de-breteuil/` existe déjà : c'est l'espace client
**chiffré** (mot de passe, documents de migration, démo chiffrée dans `demo/`).
L'Espace Breteuil, lui, doit être **public et installable sans connexion** : le
mélanger avec un dossier chiffré (et son propre service worker de portée `./`)
aurait créé des conflits de cache et de portée. Il a donc son propre dossier,
sa propre portée de service worker et son propre manifeste. Rien de l'existant
n'est modifié.

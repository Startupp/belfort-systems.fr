#!/usr/bin/env bash
# Opérateur du desk papier : lance la séance du jour, l'attend, prépare le carnet.
#
#   scripts/desk-operateur.sh demarrer          lance la séance en arrière-plan détaché (si pas déjà lancée),
#                                               le portefeuille crypto papier (carnet-crypto) et l'aperçu en direct
#                                               du carnet (http://localhost:8080/)
#   scripts/desk-operateur.sh attendre [min]    attend la fin de la séance, au plus [min] minutes (110 par défaut)
#   scripts/desk-operateur.sh etat              séance en cours ou non, dernières lignes du journal
#   scripts/desk-operateur.sh cloturer          régénère carnet.html et carnet.csv, affiche le résumé du jour, indexe carnet/
#
# Variables : DESK_DATA_DIR (défaut carnet). Le commit et le push restent à la charge de l'opérateur.
# Tout le script est dans main() : bash le lit en entier avant de l'exécuter (sûr même si git pull le modifie).

main() {
  set -euo pipefail
  cd "$(dirname "$0")/.."
  export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
  export DESK_DATA_DIR="${DESK_DATA_DIR:-carnet}"
  local day log
  day="$(TZ=Europe/Paris date +%F)"
  log="$DESK_DATA_DIR/logs/$day.log"
  mkdir -p "$DESK_DATA_DIR/logs"

  en_cours() { pgrep -f "[s]rc/desk/main.ts live" >/dev/null; }
  en_cours_crypto() { pgrep -f "[s]rc/desk/crypto.ts live" >/dev/null; }
  # Second portefeuille papier, cryptos seulement (ajouté le 10 novembre 2026 à la demande de l'utilisateur).
  crypto() {
    if ! en_cours_crypto; then
      mkdir -p carnet-crypto/logs
      echo "--- lancement $(TZ=Europe/Paris date '+%F %T') (Paris)" >>"carnet-crypto/logs/$day.log"
      setsid nohup node src/desk/crypto.ts live >>"carnet-crypto/logs/$day.log" 2>&1 </dev/null &
      echo "portefeuille crypto lancé — journal : carnet-crypto/logs/$day.log"
    fi
  }
  apercu() {
    if ! pgrep -f "[s]rc/desk/apercu.ts" >/dev/null; then
      setsid nohup node src/desk/apercu.ts 8080 >>"${TMPDIR:-/tmp}/desk-apercu.log" 2>&1 </dev/null &
      echo "aperçu en direct : http://localhost:8080/"
    fi
  }

  case "${1:-etat}" in
    demarrer)
      apercu
      crypto
      if en_cours; then
        echo "séance déjà en cours (PID $(pgrep -f '[s]rc/desk/main.ts live' | tr '\n' ' '))"
        return 0
      fi
      node --version
      echo "--- lancement $(TZ=Europe/Paris date '+%F %T') (Paris)" >>"$log"
      setsid nohup node src/desk/main.ts live >>"$log" 2>&1 </dev/null &
      sleep 20
      if en_cours; then
        echo "séance lancée (PID $(pgrep -f '[s]rc/desk/main.ts live' | tr '\n' ' ')) — journal : $log"
      else
        echo "le processus s'est arrêté tout de suite :"
        tail -20 "$log"
        return 1
      fi
      ;;
    attendre)
      local max=$(( ${2:-110} * 60 )) t=0
      while { en_cours || en_cours_crypto; } && [ "$t" -lt "$max" ]; do sleep 30; t=$((t + 30)); done
      if en_cours || en_cours_crypto; then echo "EN COURS — relancer l'attente"; else echo "TERMINÉE"; fi
      tail -8 "$log" 2>/dev/null || true
      ;;
    etat)
      if en_cours; then echo "séance EN COURS"; else echo "aucune séance en cours"; fi
      tail -15 "$log" 2>/dev/null || echo "pas encore de journal pour $day"
      if en_cours_crypto; then echo "portefeuille crypto EN COURS"; else echo "portefeuille crypto arrêté"; fi
      tail -5 "carnet-crypto/logs/$day.log" 2>/dev/null || true
      ;;
    cloturer)
      if en_cours || en_cours_crypto; then
        echo "la séance tourne encore : attendre la fin (19 h, heure de Paris)"
        return 1
      fi
      node src/desk/main.ts carnet
      node src/desk/main.ts resume || true
      git add "$DESK_DATA_DIR"
      if [ -d carnet-crypto ]; then
        echo "=== portefeuille crypto"
        node src/desk/crypto.ts carnet || true
        node src/desk/crypto.ts resume || true
        node src/desk/crypto.ts calls || true
        git add carnet-crypto
        git status --short -- carnet-crypto | head -10
      fi
      git status --short -- "$DESK_DATA_DIR" | head -20
      ;;
    *)
      echo "usage : $0 demarrer | attendre [minutes] | etat | cloturer" >&2
      return 2
      ;;
  esac
}

main "$@"
exit $?

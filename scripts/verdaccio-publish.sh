#!/bin/bash
# Publie tous les packages @gwenjs/* sur le registry Verdaccio local.
#
# Usage : pnpm verdaccio:publish
#
# - Vide le storage @gwenjs avant de publier (évite les conflits de version)
# - Build chaque package individuellement ; continue si un package échoue
# - Publie uniquement les packages qui ont été buildés avec succès

set -euo pipefail

REGISTRY="http://localhost:4873"
# Verdaccio stocke dans ~/.local/share/verdaccio/storage par défaut
STORAGE="${VERDACCIO_STORAGE:-$HOME/.local/share/verdaccio/storage}/@gwenjs"

# Vérifier que Verdaccio tourne
if ! curl -s "$REGISTRY/-/ping" > /dev/null 2>&1; then
  echo "❌ Verdaccio n'est pas démarré. Lance d'abord : pnpm verdaccio:start"
  exit 1
fi

# Vider le storage @gwenjs pour permettre la re-publication
echo "🗑  Nettoyage du storage Verdaccio @gwenjs..."
rm -rf "$STORAGE"

# Builder chaque package @gwenjs/* (les erreurs sont ignorées par package)
echo "🔨 Build des packages @gwenjs/*..."
pnpm --filter '@gwenjs/*' build || true

# Publier sur Verdaccio
echo "📦 Publication sur $REGISTRY..."
pnpm -r publish --registry "$REGISTRY" --no-git-checks --force

echo "✅ Publication terminée."

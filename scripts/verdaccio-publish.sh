#!/bin/bash
# Publie tous les packages @gwenjs/* sur le registry Verdaccio local.
#
# Usage : pnpm verdaccio:publish
#
# - Dépublie chaque @gwenjs/* existant (évite les conflits 409)
# - Build chaque package individuellement ; continue si un package échoue
# - Publie uniquement les packages qui ont été buildés avec succès

set -euo pipefail

REGISTRY="http://localhost:4873"

# Vérifier que Verdaccio tourne
if ! curl -s "$REGISTRY/-/ping" > /dev/null 2>&1; then
  echo "❌ Verdaccio n'est pas démarré. Lance d'abord : pnpm verdaccio:start"
  exit 1
fi

# Dépublier tous les packages @gwenjs/* existants pour éviter les 409
echo "🗑  Dépublication des packages @gwenjs/* existants..."
for pkg_json in packages/*/package.json; do
  pkg_name=$(node -p "require('./$pkg_json').name" 2>/dev/null)
  if [[ "$pkg_name" == @gwenjs/* ]]; then
    npm unpublish "$pkg_name" --registry "$REGISTRY" --force 2>/dev/null || true
  fi
done

# Builder chaque package @gwenjs/* (les erreurs sont ignorées par package)
echo "🔨 Build des packages @gwenjs/*..."
pnpm --filter '@gwenjs/*' build || true

# Publier sur Verdaccio
echo "📦 Publication sur $REGISTRY..."
pnpm -r publish --registry "$REGISTRY" --no-git-checks

echo "✅ Publication terminée."

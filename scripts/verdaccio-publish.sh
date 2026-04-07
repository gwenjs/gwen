#!/bin/bash
# Publie tous les packages @gwenjs/* sur le registry Verdaccio local.
#
# Usage : pnpm verdaccio:publish
#
# - Dépublie chaque @gwenjs/* existant (évite les conflits 409)
# - Build chaque package individuellement ; continue si un package échoue
# - Publie chaque package individuellement pour garantir la publication

set -euo pipefail

REGISTRY="http://localhost:4873"
STORAGE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.verdaccio/storage/@gwenjs"

# Vérifier que Verdaccio tourne
if ! curl -s "$REGISTRY/-/ping" > /dev/null 2>&1; then
  echo "❌ Verdaccio n'est pas démarré. Lance d'abord : pnpm verdaccio:start"
  exit 1
fi

# Dépublier tous les packages @gwenjs/* existants pour éviter les 409
echo "🗑  Dépublication des packages @gwenjs/* existants..."
for pkg_json in "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"/packages/*/package.json; do
  pkg_name=$(node -p "require('$pkg_json').name" 2>/dev/null)
  if [[ "$pkg_name" == @gwenjs/* ]]; then
    pnpm unpublish "$pkg_name" --registry "$REGISTRY" --force 2>/dev/null || true
  fi
done

# Nettoyer le storage sur disque pour éviter les conflits résiduels
echo "🗑  Nettoyage du storage disque..."
rm -rf "$STORAGE"

# Builder chaque package @gwenjs/* (les erreurs sont ignorées par package)
echo "🔨 Build des packages @gwenjs/*..."
pnpm --filter '@gwenjs/*' build || true

# Publier chaque package individuellement
echo "📦 Publication sur $REGISTRY..."
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for pkg_dir in "$ROOT"/packages/*/; do
  pkg_json="$pkg_dir/package.json"
  [[ -f "$pkg_json" ]] || continue
  pkg_name=$(node -p "require('$pkg_json').name" 2>/dev/null)
  [[ "$pkg_name" == @gwenjs/* ]] || continue

  echo "  → $pkg_name"
  (cd "$pkg_dir" && pnpm publish --registry "$REGISTRY" --no-git-checks --force 2>&1) || \
    echo "  ⚠ $pkg_name : publication échouée (ignorée)"
done

echo "✅ Publication terminée."
echo ""
echo "📋 Packages disponibles :"
pnpm view '@gwenjs/*' version --registry "$REGISTRY" 2>/dev/null || \
curl -s "$REGISTRY/-/search?text=@gwenjs" | node -e "
let d='';
process.stdin.on('data',c=>d+=c).on('end',()=>{
  const r=JSON.parse(d);
  (r.objects||[]).forEach(o=>console.log('  '+o.package.name+'@'+o.package.version));
})"

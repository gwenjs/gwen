#!/bin/bash
# Publie tous les packages @gwenjs/* sur le registry Verdaccio local.
#
# Usage : pnpm verdaccio:publish
#
# - Supprime le storage @gwenjs/* sur disque (évite tous les conflits 409)
# - Build chaque package avec pnpm (workspace)
# - Publie chaque package individuellement

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="http://localhost:4873"
VERDACCIO_CONFIG="$ROOT/verdaccio.yaml"
VERDACCIO_STORAGE="${HOME}/.local/share/verdaccio/storage"
GWENJS_STORAGE="$VERDACCIO_STORAGE/@gwenjs"
DB_FILE="$VERDACCIO_STORAGE/.verdaccio-db.json"

# S'assurer que la config Verdaccio a une règle @gwenjs/* sans proxy.
# Sans ça, Verdaccio refuse de publier des versions déjà présentes sur npm réel.
if ! grep -q "^  '@gwenjs/\*'" "$VERDACCIO_CONFIG" 2>/dev/null; then
  echo "⚙️  Ajout de la règle @gwenjs/* (sans proxy) dans la config Verdaccio..."
  node -e "
    const fs = require('fs');
    const content = fs.readFileSync('$VERDACCIO_CONFIG', 'utf8');
    const rule = [
      \"  '@gwenjs/*':\",
      \"    access: \\\$all\",
      \"    publish: \\\$authenticated\",
      \"    unpublish: \\\$authenticated\",
      \"\",
    ].join('\n');
    // ^packages: matche uniquement la ligne de section, pas les commentaires
    fs.writeFileSync('$VERDACCIO_CONFIG', content.replace(/^packages:/m, 'packages:\n' + rule));
  "
  echo ""
  echo "❌ Config Verdaccio mise à jour — redémarre Verdaccio puis relance ce script."
  exit 1
fi

# Vérifier que Verdaccio tourne
if ! curl -s "$REGISTRY/-/ping" > /dev/null 2>&1; then
  echo "❌ Verdaccio n'est pas démarré. Lance d'abord : pnpm verdaccio:start"
  exit 1
fi

# Dépublier chaque package via l'API Verdaccio puis supprimer le storage
echo "🗑  Dépublication et nettoyage des packages @gwenjs/*..."
for pkg_dir in "$ROOT"/packages/*/; do
  pkg_json="$pkg_dir/package.json"
  [[ -f "$pkg_json" ]] || continue
  pkg_name=$(node -p "require('$pkg_json').name" 2>/dev/null)
  [[ "$pkg_name" == @gwenjs/* ]] || continue
  npm unpublish "$pkg_name" --registry "$REGISTRY" --force 2>/dev/null || true
done

# Supprimer le storage @gwenjs/* sur disque (élimine les métadonnées résiduelles)
rm -rf "$GWENJS_STORAGE"

# Retirer les entrées @gwenjs/* de la base de données Verdaccio
if [[ -f "$DB_FILE" ]]; then
  node -e "
    const fs = require('fs');
    const db = JSON.parse(fs.readFileSync('$DB_FILE', 'utf8'));
    db.list = (db.list || []).filter(p => !p.startsWith('@gwenjs/'));
    fs.writeFileSync('$DB_FILE', JSON.stringify(db));
  "
fi

# Builder chaque package @gwenjs/* (les erreurs sont ignorées par package)
echo "🔨 Build des packages @gwenjs/*..."
pnpm --filter '@gwenjs/*' build || true
node "$ROOT/scripts/fix-dts-extensions.mjs"

# Publier chaque package individuellement
echo "📦 Publication sur $REGISTRY..."
for pkg_dir in "$ROOT"/packages/*/; do
  pkg_json="$pkg_dir/package.json"
  [[ -f "$pkg_json" ]] || continue
  pkg_name=$(node -p "require('$pkg_json').name" 2>/dev/null)
  [[ "$pkg_name" == @gwenjs/* ]] || continue

  echo "  → $pkg_name"
  (cd "$pkg_dir" && pnpm publish --registry "$REGISTRY" --no-git-checks 2>&1) || \
    echo "  ⚠ $pkg_name : publication échouée (ignorée)"
done

echo "✅ Publication terminée."
echo ""
echo "📋 Packages disponibles :"
for pkg_json in "$ROOT"/packages/*/package.json; do
  pkg_name=$(node -p "require('$pkg_json').name" 2>/dev/null)
  [[ "$pkg_name" == @gwenjs/* ]] || continue
  version=$(curl -s "$REGISTRY/$pkg_name" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const p=JSON.parse(d);console.log(p['dist-tags']?.latest||'❌ absent')}catch{console.log('❌ erreur')}})")
  echo "  $pkg_name@$version"
done

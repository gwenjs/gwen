---
title: "@gwenjs/schema"
description: "Référence API pour @gwenjs/schema."
---

# @gwenjs/schema

`pnpm add @gwenjs/schema`

Définitions de types partagées pour GWEN. Principalement utilisé en interne et par les auteurs de plugins. Fournit des types unifiés pour les composants, systèmes et hooks.

## Définitions de type

### GwenHookHandler

**Signature:**
```ts
type GwenHookHandler = (...args: readonly unknown[]) => unknown
```

**Description.** Gestionnaire de hook générique. Les arguments sont un `readonly unknown[]`. Le type de retour est `unknown`.

### DeepPartial\<T\>

**Signature:**
```ts
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T
```

**Description.** Quand `T` est un objet, chaque propriété est optionnelle et elle-même un `DeepPartial`. Sinon le type est `T`.

La configuration utilisateur est `GwenUserConfig` dans `@gwenjs/app` et `resolveGwenConfig` dans `@gwenjs/app/resolve`. Voir `### ResolvedGwenConfig` dans `docs/fr/api/app.md`. Le tableau des champs est `## Référence de configuration` dans `docs/fr/essentials/engine.md`.

## Erreurs

Champs de `GwenError` : `code`, `composable`, `hint`, `docsUrl`.

Tout appel produit `[where] what`, une ligne `Fix:` facultative et une ligne `See`. Deux arguments utilisent `GWEN` comme `where`. `docsUrl` est toujours défini à partir du code et du `docsBase` de la classe qui construit l'erreur.

Valeurs : `GWEN_DOCS_BASE`, `errorDocsAnchor`, `errorDocsUrl`.

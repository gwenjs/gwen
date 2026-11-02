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

### GwenServiceKey

**Signature :**
```ts
type GwenServiceKey = keyof GwenProvides & string
```

**Description.** Une clé de `GwenProvides`. Les clés de service n'ont pas de règle de nom, sauf le préfixe réservé `renderer:<name>`. Seule une valeur `RendererService` peut utiliser ce préfixe. Rien ne vérifie encore ce préfixe.

### GwenEngineBase

Méthodes du registre de services sur la surface moteur que reçoivent les plugins. Chaque clé est un `GwenServiceKey`. Le type de la valeur est `GwenProvides[K]`.

| Méthode | Signature |
|---|---|
| `provide` | `provide<K extends GwenServiceKey>(key: K, value: GwenProvides[K]): void` |
| `inject` | `inject<K extends GwenServiceKey>(key: K): GwenProvides[K]` |
| `tryInject` | `tryInject<K extends GwenServiceKey>(key: K): GwenProvides[K] \| undefined` |

## Erreurs

Champs de `GwenError` : `code`, `composable`, `hint`, `docsUrl`.

Tout appel produit `[where] what`, une ligne `Fix:` facultative et une ligne `See`. Deux arguments utilisent `GWEN` comme `where`. `docsUrl` est toujours défini à partir du code et du `docsBase` de la classe qui construit l'erreur.

Valeurs : `GWEN_DOCS_BASE`, `errorDocsAnchor`, `errorDocsUrl`.

## Plage du framework

`CORE_RANGE` vaut `"^1.0.0-alpha.0"`.

Plage de dépendance du groupe framework lié : core, kit, physics2d, physics3d, renderer-core, et camera-core. physics-core le rejoint avec #58 P-58-0. Un plugin déclare ses pairs `@gwenjs/*` sur cette plage. Elle ne satisfait pas `0.2.x`. Elle correspond aux estampilles du harnais de pile `1.0.0-integration.<UTC yyyymmddHHMMSS>.g<sha7>`.

Valeur : `CORE_RANGE`.

---
title: Pipeline de build
description: Comment GWEN réécrit votre source au build, quels appels il reconnaît et les erreurs qu'il peut lever.
---

# Pipeline de build

`@gwenjs/vite` réécrit le source de votre jeu avant que Vite ne le bundle. Il injecte des noms lisibles, enveloppe les `await` dans les callbacks de contexte et remonte les tableaux de requêtes. Vous écrivez du code GWEN ordinaire. Le pipeline fait le reste.

## Fonctionnement

- **Une seule analyse par module.** Le plugin `gwen:transform-pipeline` analyse chaque module script une fois (`packages/vite/src/pipeline/transform-pipeline.ts:182`). Chaque unité lit ce même programme.
- **Des unités pures.** Une unité lit le programme et renvoie une liste d'éditions. Elle n'écrit jamais le fichier et ne ré-analyse jamais (`packages/vite/src/pipeline/transform-pipeline.ts:209-212`).
- **Éditions appliquées ensemble.** Le pipeline rassemble les éditions de toutes les unités, puis les applique en une seule étape (`packages/vite/src/pipeline/transform-pipeline.ts:213`). Deux éditions sur la même plage lèvent `VITE:TRANSFORM_EDIT_CONFLICT`.
- **S'exécute en premier.** Le plugin utilise `enforce: "pre"` (`packages/vite/src/pipeline/transform-pipeline.ts:169`) : les unités voient votre source avant les autres plugins.
- **Serve égale build.** Le hook `transform` exécute les mêmes unités dans `vite dev` et `vite build`. Seuls les fichiers d'assets émis diffèrent : ils n'existent qu'au build (`packages/vite/src/pipeline/transform-pipeline.ts:195`).
- **Aucun module ignoré.** Un module qui ne peut pas être analysé fait échouer le build avec `VITE:TRANSFORM_PARSE_FAILED` (`packages/vite/src/pipeline/parse.ts:69`).

## Unités

`BUILT_IN_UNITS` liste les unités qui s'exécutent toujours, dans l'ordre d'application (`packages/vite/src/pipeline/registry.ts:10`).

| Unité | Rôle |
|---|---|
| `gwen:async-context` | Enveloppe chaque `await` d'un handler async de `onEnter`, `onExit`, `onPreload` ou `withAsyncContext`. |
| `gwen:system-name` | Insère le nom de la variable dans `const Name = defineSystem(setup)`. |
| `gwen:actor-name` | Insère le nom de la variable dans une déclaration `defineActor`. |
| `gwen:layout-name` | Nomme `const Level1 = defineLayout(...)`. |
| `gwen:scene-router-name` | Nomme `const AppRouter = defineSceneRouter(...)`. |
| `gwen:query-hoist` | Remonte le tableau de `useQuery([A, B])` dans une constante de module. |

Un plugin peut ajouter une unité avant `buildStart` avec `register()` sur le pipeline. Les plugins de physique le font :

| Unité | Enregistrée par | Rôle |
|---|---|---|
| `gwen:layer-inline` | `physics2d` et `physics3d` (`packages/physics2d/src/vite-plugin.ts:68`, `packages/physics3d/src/vite-plugin.ts:181`) | Remplace `L.name`, issu de `const L = defineLayers({ ... })`, par sa valeur numérique. |
| `gwen:bvh-prebake` | `physics3d`, quand `bvhPrebake` vaut `true` (`packages/physics3d/src/vite-plugin.ts:182`) | Réécrit un chemin `.glb` relatif passé à `useMeshCollider`. |

## Quels appels sont reconnus

Une unité ne reconnaît jamais un appel par son texte. Elle résout l'appelé par la liaison d'import du module. Un appel compte quand il résout vers un export GWEN listé dans `CANONICAL` (`packages/vite/src/pipeline/canonical.ts:31`).

| Style | Exemple | Reconnu |
|---|---|---|
| Import nommé | `import { defineSystem } from '@gwenjs/core/system'` | Oui |
| Alias | `import { defineSystem as sys } from '@gwenjs/core/system'`, puis `sys(...)` | Oui |
| Espace de noms | `import * as gwen from '@gwenjs/core/system'`, puis `gwen.defineSystem(...)` | Oui |
| Auto-import | `defineSystem(...)` sans import, quand il est dans la liste d'auto-imports | Oui |
| Barrel du projet | `import { defineSystem } from './barrel'` où le barrel ré-exporte GWEN | Oui |
| Local qui masque | une `function defineSystem() {}` locale masque l'import | Non |
| Membre d'un autre objet | `utils.defineSystem(...)` où `utils` n'est pas un import d'espace de noms | Non |
| Autre paquet | `import { defineSystem } from 'some-lib'` | Non |

Les règles sont dans `packages/vite/src/pipeline/resolve-callee.ts` : un membre d'espace de noms demande un import d'espace de noms (`:113-115`), une déclaration locale l'emporte sur l'import (`:123`), et un auto-import ne vaut que pour un nom sans déclaration (`:122`). Une source hors de `CANONICAL` ne correspond jamais (`packages/vite/src/pipeline/canonical.ts:71-78`). Le pipeline suit les barrels du projet avant l'exécution des unités (`packages/vite/src/pipeline/transform-pipeline.ts:187`). Les scanners ne les suivent pas (voir plus bas).

## Erreurs

Le pipeline lève ces codes. Chaque entrée de la page donne la cause et le correctif.

| Code | Quand |
|---|---|
| [`VITE:TRANSFORM_PARSE_FAILED`](/fr/api/errors#vite-transform-parse-failed) | Un module a une erreur de syntaxe. Le message commence par `<fichier>:<ligne>:<colonne>`. |
| [`VITE:TRANSFORM_EDIT_CONFLICT`](/fr/api/errors#vite-transform-edit-conflict) | Deux unités éditent des plages qui se chevauchent dans un module. |
| [`VITE:TRANSFORM_UNSUPPORTED`](/fr/api/errors#vite-transform-unsupported) | `register()` est appelé après `buildStart`, ou une unité rencontre une forme qu'elle ne sait pas réécrire, comme un `await` imbriqué. |
| [`VITE:BVH_PREBAKE_FAILED`](/fr/api/errors#vite-bvh-prebake-failed) | Le calcul BVH d'un maillage `.glb` a échoué. |

## Scanners

Certaines étapes du build ont besoin de faits sur plusieurs fichiers à la fois, pas d'une réécriture. `@gwenjs/vite/scanners` y répond : noms de scènes, exports `defineHooks`, noms `defineLayout` et noms d'easing. Les scanners suivent les règles du pipeline :

- Ils analysent avec `parseModule` : un fichier avec une erreur de syntaxe lève `VITE:TRANSFORM_PARSE_FAILED`. Aucun fichier n'est ignoré.
- Un fichier illisible lève le même code. Le message est `<file> could not be read.` et `cause` est l'erreur Node (`packages/vite/src/scanners/read.ts:37`).
- Ils reconnaissent les appelés par les liaisons d'import. Un appel sans import demande l'option `autoImports`.
- Ils ne suivent pas les barrels : `followed` est vide (`packages/vite/src/scanners/read.ts:48`). Importez la fonction GWEN depuis son paquet dans un fichier scanné, ou comptez sur les auto-imports.

Voir [`@gwenjs/vite/scanners`](/fr/api/vite#vite-scanners) pour les signatures.

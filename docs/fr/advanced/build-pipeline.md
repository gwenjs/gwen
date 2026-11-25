---
title: Pipeline de build
description: Comment GWEN réécrit votre source au build, quels appels il reconnaît et les erreurs qu'il peut lever.
---

# Pipeline de build

`@gwenjs/vite` réécrit le source de votre jeu avant que Vite ne le bundle. Il injecte des noms lisibles, enveloppe les `await` dans les callbacks de contexte et remonte les tableaux de requêtes. Avec `optimizer` activé, il lit aussi une seule fois les colonnes d'une boucle de lignes de chunk. Vous écrivez du code GWEN ordinaire. Le pipeline fait le reste.

## Fonctionnement

- **Une seule analyse par module.** Le plugin `gwen:transform-pipeline` analyse chaque module script une fois (`packages/vite/src/pipeline/transform-pipeline.ts:182`). Chaque unité lit ce même programme.
- **Des unités pures.** Une unité lit le programme et renvoie une liste d'éditions. Elle n'écrit jamais le fichier et ne ré-analyse jamais (`packages/vite/src/pipeline/transform-pipeline.ts:209-212`).
- **Éditions appliquées ensemble.** Le pipeline rassemble les éditions de toutes les unités, puis les applique en une seule étape (`packages/vite/src/pipeline/transform-pipeline.ts:213`). Deux éditions sur la même plage lèvent `VITE:TRANSFORM_EDIT_CONFLICT`.
- **S'exécute en premier.** Le plugin utilise `enforce: "pre"` (`packages/vite/src/pipeline/transform-pipeline.ts:169`) : les unités voient votre source avant les autres plugins.
- **Serve égale build.** Le hook `transform` exécute les mêmes unités dans `vite dev` et `vite build`. Seuls les fichiers d'assets émis diffèrent : ils n'existent qu'au build (`packages/vite/src/pipeline/transform-pipeline.ts:195`).
- **Aucun module ignoré.** Un module qui ne peut pas être analysé fait échouer le build avec `VITE:TRANSFORM_PARSE_FAILED` (`packages/vite/src/pipeline/parse.ts:69`).

## Unités

`BUILT_IN_UNITS` liste les unités qui s'exécutent toujours, dans l'ordre d'application (`packages/vite/src/pipeline/registry.ts:13`).

| Unité | Rôle |
|---|---|
| `gwen:async-context` | Enveloppe chaque `await` d'un handler async de `onEnter`, `onExit`, `onPreload` ou `withAsyncContext`. |
| `gwen:system-name` | Insère le nom de la variable dans `const Name = defineSystem(setup)`. |
| `gwen:actor-name` | Insère le nom de la variable dans une déclaration `defineActor`. |
| `gwen:layout-name` | Nomme `const Level1 = defineLayout(...)`. |
| `gwen:scene-router-name` | Nomme `const AppRouter = defineSceneRouter(...)`. |
| `gwen:query-hoist` | Remonte le tableau de `useQuery([A, B])` dans une constante de module. |
| `gwen:hot-path-warn` | Avertit quand `useQuery`, `useService` ou `useWasmModule` est appelé dans un callback de frame. Elle ne modifie jamais la source. |

Un plugin peut ajouter une unité avant `buildStart` avec `register()` sur le pipeline. Les plugins de physique et `gwen()` le font :

| Unité | Enregistrée par | Rôle |
|---|---|---|
| `gwen:layer-inline` | `physics2d` et `physics3d` (`packages/physics2d/src/vite-plugin.ts:68`, `packages/physics3d/src/vite-plugin.ts:181`) | Remplace `L.name`, issu de `const L = defineLayers({ ... })`, par sa valeur numérique. |
| `gwen:bvh-prebake` | `physics3d`, quand `bvhPrebake` vaut `true` (`packages/physics3d/src/vite-plugin.ts:182`) | Réécrit un chemin `.glb` relatif passé à `useMeshCollider`. |
| `gwen:variant-guard` | `gwen()`, une fois la config résolue (`packages/vite/src/index.ts:136`) | Lève `VITE:VARIANT_REQUIRED` pour un import par valeur de `@gwenjs/physics2d` ou `@gwenjs/physics3d` que le variant résolu ou `modules` n'autorise pas. Elle n'édite jamais. |

`gwenVitePlugin()` n'a pas de config résolue : il n'exécute pas la garde (`packages/vite/tests/transform-pipeline/variant-guard.test.ts:275`). Seuls les modules sous la racine du projet sont vérifiés.

`OPTIMIZER_UNITS` liste les unités qui ne s'exécutent que lorsque l'option `optimizer` vaut `true` ou un objet. Elles s'exécutent après les unités intégrées (`packages/vite/src/pipeline/registry.ts:24`, `packages/vite/src/plugins/index.ts:84`). Avec `false` ou sans option, elles ne sont pas enregistrées.

| Unité | Rôle |
|---|---|
| `gwen:hoist-chunk-columns` | Lit une seule fois, avant la boucle, chaque `chunk.get(Def)` d'une boucle de lignes de chunk. Voir [Remonter les lectures de colonnes](#hoisting-column-lookups). |

## Remonter les lectures de colonnes {#hoisting-column-lookups}

`chunk.get(Def)` dans une boucle de lignes est rappelé à chaque ligne. Avec `optimizer` activé, `gwen:hoist-chunk-columns` lit une seule fois chaque `chunk.get(Def)` distinct d'un `for` interne, dans une `const` placée juste avant ce `for`, et la boucle utilise la variable locale. Votre propre `const pos = chunk.get(Position)` garde son nom et devient `const pos = _gwen_c0;`. L'unité ne lit pas `chunk.count` dans une variable locale, n'ajoute aucun nombre à la sortie et ne trouve rien à changer dans sa propre sortie. Chaque nom généré `_gwen_c<N>` est unique dans le module : `N` augmente d'un système à l'autre et saute un nom que le module utilise déjà (`packages/vite/src/transforms/hoist-chunk-columns.ts:142`).

```ts
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
    }
  });
});
```

La boucle ci-dessus devient :

```ts
for (const chunk of q) {
  const _gwen_c0 = chunk.get(Position);
  const _gwen_c1 = chunk.get(Velocity);
  for (let i = 0; i < chunk.count; i++) {
    _gwen_c0.x[i] += _gwen_c1.vx[i] * dt;
  }
}
```

Une boucle n'est réécrite que si les sept préconditions sont réunies. Sinon elle reste telle que vous l'avez écrite, et le build n'avertit pas :

1. **Boucle externe.** `for (const chunk of q)` avec une seule variable `const` et sans `await`. C'est une instruction directe de la fonction passée à `onBeforeUpdate`, `onUpdate`, `onAfterUpdate` ou `onRender`, et cet appel est une instruction directe d'une fabrique `defineSystem` ou `defineActor` (`packages/vite/src/transforms/hoist-chunk-columns.ts:501`, `packages/vite/src/transforms/hoist-chunk-columns.ts:514`).
2. **Requête.** `q` est une `const` qui est une instruction directe de la même fabrique, initialisée par `useQuery([A, B])` avec un seul tableau de noms simples (`packages/vite/src/transforms/hoist-chunk-columns.ts:428`).
3. **Définitions.** Chaque `chunk.get(D)` a un seul nom `D`, pris dans ce tableau, qui est un import ou une `const` de module. `chunk` est la variable de la boucle elle-même, pas une variable locale du même nom (`packages/vite/src/transforms/hoist-chunk-columns.ts:396`).
4. **Boucle interne.** Un `for` qui est une instruction directe du corps externe. Chacun est jugé seul.
5. **Corps.** Seulement les formes d'une boucle numérique simple : arithmétique, `let` et `const`, affectation, `if`, `for` imbriqué, appels `Math.*`, `chunk.count`, et lectures et écritures de membres sur des valeurs `chunk.get(D)`. `as`, `satisfies`, `!` et les parenthèses sont conservés. Toute autre forme, comme un appel, une chaîne modèle, `await`, une fonction, `try`, une étiquette ou une déstructuration, laisse la boucle inchangée. La liste est fermée : un type de nœud qui n'est pas nommé est refusé (`packages/vite/src/transforms/hoist-chunk-columns.ts:310`).
6. **Pas d'appel structurel.** Un appel nommé `addComponent`, `removeComponent`, `destroyEntity` ou `createEntity` dans la boucle, car il déplace des lignes et les colonnes peuvent changer (`packages/vite/src/transforms/hoist-chunk-columns.ts:369`).
7. **Pas de désactivation.** Voir ci-dessous.

`// @gwen-no-optimize` avant le `for` externe, avant l'appel de frame, avant une instruction qui les englobe, avant un `for` interne ou avant une instruction dans un `for` interne garde la boucle telle qu'écrite ; une boucle interne qui porte la directive, ou dont une instruction imbriquée la porte, reste entière, et ses voisines sont toujours hissées (`packages/vite/src/transforms/hoist-chunk-columns.ts:528`, `packages/vite/src/transforms/hoist-chunk-columns.ts:599`). Voir [Désactiver une optimisation](#opting-out).

## Quels appels sont reconnus

Une unité ne reconnaît jamais un appel par son texte. Elle résout l'appelé par la liaison d'import du module. Un appel compte quand il résout vers un export GWEN listé dans `CANONICAL` (`packages/vite/src/pipeline/canonical.ts:36`).

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

Les règles sont dans `packages/vite/src/pipeline/resolve-callee.ts` : un membre d'espace de noms demande un import d'espace de noms (`:113-115`), une déclaration locale l'emporte sur l'import (`:123`), et un auto-import ne vaut que pour un nom sans déclaration (`:122`). Une source hors de `CANONICAL` ne correspond jamais (`packages/vite/src/pipeline/canonical.ts:81-88`). Le pipeline suit les barrels du projet avant l'exécution des unités (`packages/vite/src/pipeline/transform-pipeline.ts:187`). Les scanners ne les suivent pas (voir plus bas).

## Recherches à chaque frame {#per-frame-lookups}

`gwen:hot-path-warn` journalise un avertissement de build quand `useQuery`, `useService` ou `useWasmModule` est appelé dans la fonction passée à `onBeforeUpdate`, `onUpdate`, `onAfterUpdate` ou `onRender` (`packages/vite/src/transforms/hot-path-warn.ts:60`). Cette fonction s'exécute à chaque frame, donc la recherche aussi. L'unité lit la source et ne déplace rien. Elle journalise une fois par site d'appel, avec le code `VITE:HOT_PATH_LOOKUP`, et le build n'échoue jamais à cause d'elle (`packages/vite/src/transforms/hot-path-warn.ts:94`).

Les règles :

- Les noms sont les fonctions GWEN résolues : un alias comme `useService as svc` est trouvé.
- Un `defineSystem` ou un `defineActor` dans le callback a son propre setup. Une recherche dans ce setup n'est pas signalée.
- Une autre fonction dans le callback, comme `forEach(() => ...)`, ne change pas la réponse : la recherche reste à chaque frame.
- Une recherche dans les arguments de l'appel de frame, comme dans `onUpdate(useService("k").tick)`, s'exécute une fois et n'est pas signalée.
- Une référence de fonction, comme dans `onUpdate(tick)`, n'a pas de corps à lire ici : rien n'est signalé.

Appelez la recherche une fois dans le setup et utilisez la valeur capturée dans le callback. Pour un service qui peut être absent ou remplacé, gardez `optionalService(engine, key)` depuis le setup et lisez `.current` dans le callback :

```ts
import { useEngine } from "@gwenjs/core";
import { defineSystem, onUpdate } from "@gwenjs/core/system";
import { optionalService } from "@gwenjs/kit/plugin";

export const Audio = defineSystem("Audio", () => {
  const audio = optionalService(useEngine(), "audio");
  onUpdate(() => {
    audio.current?.play("tick");
  });
});
```

Chaque transformation d'un module journalise ses propres avertissements (`packages/vite/src/pipeline/transform-pipeline.ts:335`) : une nouvelle transformation dans `vite dev` les journalise donc à nouveau.

## Désactiver une optimisation {#opting-out}

`// @gwen-no-optimize` désactive les unités d'optimisation là où il s'applique (`packages/vite/src/pipeline/opt-out.ts:27`). Seules `gwen:query-hoist` (`packages/vite/src/transforms/query-hoist.ts:191`), `gwen:hot-path-warn` (`packages/vite/src/transforms/hot-path-warn.ts:70`) et `gwen:hoist-chunk-columns` (`packages/vite/src/transforms/hoist-chunk-columns.ts:599`) le lisent.

- **Jeton exact.** Le texte du commentaire doit être `@gwen-no-optimize` et rien d'autre. `// @gwen-no-optimize-later` et `// @gwen-no-optimize please` ne sont pas des directives (`packages/vite/src/pipeline/opt-out.ts:32`).
- **Formes de commentaire.** `// ...` et `/* ... */` fonctionnent. Un JSDoc `/** ... */` ne fonctionne pas.
- **Tout le module.** Une directive placée avant la première instruction du module, y compris comme commentaire de tête de cette instruction, couvre tout le module (`packages/vite/src/pipeline/opt-out.ts:38`).
- **Un seul nœud.** Ailleurs, une directive couvre le nœud qui la suit : une instruction de premier niveau, un appel de frame comme `onUpdate(...)`, ou une instruction dans un callback. Pour `gwen:hot-path-warn`, une directive au-dessus d'une instruction dans un callback fait taire les recherches de cette instruction. Pour `gwen:query-hoist`, une directive compte sur l'instruction de premier niveau qui contient l'appel, sur l'appel `useQuery(...)` lui-même, ou avant la première instruction ; une directive sur une instruction interne d'un callback fait taire `gwen:hot-path-warn` seulement. `isOptedOut` répond pour le nœud qu'il reçoit et ne consulte pas ses ancêtres : chaque unité vérifie les nœuds englobants qui l'intéressent (`packages/vite/src/pipeline/opt-out.ts:41`).
- **Commentaire de tête seulement.** Seul le commentaire juste avant le nœud compte. Si un autre commentaire se trouve entre la directive et le nœud, la directive ne s'applique pas.

```ts
export const Audio = defineSystem("Audio", () => {
  onUpdate(() => {
    // @gwen-no-optimize
    const sfx = useService("audio");
  });
});
```

Les autres unités ne lisent pas la directive : `gwen:async-context` enveloppe les `await`, les unités de nom insèrent des noms et `gwen:variant-guard` protège le build, ce ne sont pas des optimisations. Les transformations de source des kits ne la voient pas : seul le contexte interne du pipeline porte `isOptedOut` (`packages/vite/src/pipeline/types.ts:86`).

## Erreurs

Le pipeline lève ou journalise ces codes. Chaque entrée de la page donne la cause et le correctif.

| Code | Quand |
|---|---|
| [`VITE:TRANSFORM_PARSE_FAILED`](/fr/api/errors#vite-transform-parse-failed) | Un module a une erreur de syntaxe. Le message commence par `<fichier>:<ligne>:<colonne>`. |
| [`VITE:TRANSFORM_EDIT_CONFLICT`](/fr/api/errors#vite-transform-edit-conflict) | Deux unités éditent des plages qui se chevauchent dans un module. |
| [`VITE:TRANSFORM_UNSUPPORTED`](/fr/api/errors#vite-transform-unsupported) | `register()` est appelé après `buildStart`, ou une unité rencontre une forme qu'elle ne sait pas réécrire, comme un `await` imbriqué. |
| [`VITE:BVH_PREBAKE_FAILED`](/fr/api/errors#vite-bvh-prebake-failed) | Le calcul BVH d'un maillage `.glb` a échoué. |
| [`VITE:VARIANT_REQUIRED`](/fr/api/errors#vite-variant-required) | Un module importe par valeur `@gwenjs/physics2d` ou `@gwenjs/physics3d` que le variant résolu ou `modules` n'autorise pas. |
| [`VITE:HOT_PATH_LOOKUP`](/fr/api/errors#vite-hot-path-lookup) | Un avertissement, pas une erreur : une recherche s'exécute dans un callback de frame. Le build continue. |

## Scanners

Certaines étapes du build ont besoin de faits sur plusieurs fichiers à la fois, pas d'une réécriture. `@gwenjs/vite/scanners` y répond : noms de scènes, exports `defineHooks`, noms `defineLayout`, noms d'easing et noms `loadWasmModule`. Les scanners suivent les règles du pipeline :

- Ils analysent avec `parseModule` : un fichier avec une erreur de syntaxe lève `VITE:TRANSFORM_PARSE_FAILED`. Aucun fichier n'est ignoré.
- Un fichier illisible lève le même code. Le message est `<file> could not be read.` et `cause` est l'erreur Node (`packages/vite/src/scanners/read.ts:39`).
- Ils reconnaissent les appelés par les liaisons d'import. Un appel sans import demande l'option `autoImports`. L'exception est `scanWasmModuleNames` : il reconnaît le nom de méthode `loadWasmModule` sur n'importe quel objet.
- Ils ne suivent pas les barrels : `followed` est vide (`packages/vite/src/scanners/read.ts:50`). Importez la fonction GWEN depuis son paquet dans un fichier scanné, ou comptez sur les auto-imports.

Voir [`@gwenjs/vite/scanners`](/fr/api/vite#vite-scanners) pour les signatures.

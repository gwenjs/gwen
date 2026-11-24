---
title: Transformations de source
description: Écrire un module qui réécrit les fichiers source au build avec kit.addSourceTransform, sans importer le paquet Vite.
---

# Transformations de source

Une transformation de source réécrit le code de votre jeu au build. Un module l'enregistre avec `kit.addSourceTransform`. La transformation lit un programme déjà analysé et renvoie des modifications. Elle n'importe jamais `@gwenjs/vite` ni aucun analyseur.

Cette page montre un petit plugin, `tint`. Il remplace `defineTint("red")` par le numéro de la couleur. Ensuite elle explique le contrat membre par membre.

## Comment le pipeline fonctionne {#pipeline-model}

Le framework enregistre un seul plugin Vite, `gwen:transform-pipeline`, avec `enforce: "pre"`. Il s'exécute avant les plugins normaux de Vite.

Pour chaque module, le pipeline fait ceci :

1. Il ignore les ids qui commencent par `\0`, les ids dans `/node_modules/` et les fichiers qui ne sont pas des scripts.
2. Il analyse le module une seule fois. Toutes les transformations partagent ce programme.
3. Il exécute chaque transformation dans l'ordre. Une transformation lit le code d'origine et renvoie des modifications.
4. Il applique toutes les modifications ensemble sur un seul `MagicString`, puis renvoie le nouveau code avec une source map.

Deux règles en découlent.

- Une transformation ne voit jamais le résultat d'une autre. Chacune reçoit le `code` d'origine et les offsets d'origine.
- Deux modifications qui touchent la même plage font échouer le build avec `VITE:TRANSFORM_EDIT_CONFLICT`. Une insertion exactement au début ou à la fin d'une autre modification n'est pas un conflit. Deux insertions au même offset gardent l'ordre des transformations.

Le pipeline se comporte de la même façon dans `vite dev` et dans `vite build`. Un seul appel est réservé au build : `ctx.emitAsset`.

## Un plugin d'exemple {#example}

Le plugin a deux fichiers. `tint.ts` est le runtime. Il exporte `defineTint`.

```ts check
export const tintRed = 16711680;
export const tintGreen = 65280;
export const tintBlue = 255;

/** Returns the color number for a known name, or 0 for any other string. */
export function defineTint(color: string): number {
  if (color === "red") return tintRed;
  if (color === "green") return tintGreen;
  if (color === "blue") return tintBlue;
  return 0;
}
```

`module.ts` contient la transformation et le module. Le module appelle seulement `kit.addSourceTransform`.

```ts check
import {
  defineGwenModule,
  type GwenCallSite,
  type GwenSourceTransform,
  type GwenTransformEdit,
} from "@gwenjs/kit/module";

function tintNumber(color: string): number | undefined {
  if (color === "red") return 16711680;
  if (color === "green") return 65280;
  if (color === "blue") return 255;
  return undefined;
}

function isTintCall(call: GwenCallSite): boolean {
  const binding = call.binding;
  if (binding === null) return false;
  return binding.source === "@example/tint" && binding.imported === "defineTint";
}

/** Build transform `tint:inline`. A dynamic argument is left as a runtime call. */
export const tintTransform: GwenSourceTransform = {
  name: "tint:inline",
  run(_program, ctx) {
    const edits: GwenTransformEdit[] = [];
    for (const call of ctx.calls()) {
      if (!isTintCall(call)) continue;
      const arg = call.arguments[0];
      if (arg === undefined || arg.kind === "other") continue;
      if (arg.kind !== "string") continue;
      const color = tintNumber(arg.value);
      if (color === undefined) {
        ctx.raise("TINT:UNKNOWN_COLOR", arg, `Unknown tint color "${arg.value}".`, {
          composable: "defineTint",
        });
      }
      edits.push({ kind: "overwrite", start: call.start, end: call.end, text: String(color) });
    }
    return edits;
  },
};

/** `@example/tint` module. `setup` only calls `kit.addSourceTransform`. */
export const tintModule = defineGwenModule({
  meta: { name: "@example/tint" },
  setup(_options, kit) {
    kit.addSourceTransform(tintTransform);
  },
});

export default tintModule;
```

Les deux fichiers compilent dans la vérification des docs, et le pipeline de build les exécute dans un test. Le module importe uniquement depuis `@gwenjs/kit/module`.

Ce que fait le plugin :

- `defineTint("red")` devient le numéro de couleur `16711680`.
- Un appel avec un argument dynamique, comme `defineTint(color)`, reste un appel au runtime.
- Un nom qui n'est pas une couleur connue arrête le build avec `TINT:UNKNOWN_COLOR`. L'erreur porte le fichier, la ligne et la colonne de l'argument.

Le paquet `@example/tint` exporte `tint.ts` comme runtime. Listez le module dans `gwen.config.ts`, ou placez `module.ts` dans `src/modules`.

## Le contrat {#contract}

Les types viennent de `@gwenjs/kit/module`. `@gwenjs/schema` les exporte aussi. Une transformation a un `name` et une fonction `run`. `run` reçoit le programme et un contexte.

Tous les offsets sont des index dans le texte source d'origine. Une transformation ne doit modifier ni le programme, ni un site d'appel, ni un nœud. Les modifications sont sa seule sortie.

### `ctx.id` {#ctx-id}

L'id du module en cours de transformation. C'est l'id de module que Vite donne au pipeline.

### `ctx.code` {#ctx-code}

Le texte source d'origine du module. Les offsets des modifications pointent dans cette chaîne.

### `ctx.calls()` {#ctx-calls}

Renvoie toutes les expressions d'appel du module, dans l'ordre du code source. La liste est calculée une seule fois et réutilisée par chaque transformation.

Chaque site d'appel a `start`, `end`, `arguments`, `node` et `binding`. `binding` contient la `source` et le nom `imported` quand l'appelé est un import. Il vaut `null` sinon. Voir [Reconnaître les appels](#matching) pour les règles.

Un argument a un `kind`. Un littéral chaîne donne `kind: "string"` avec sa `value`. Un littéral nombre donne `kind: "number"`. Tout le reste donne `kind: "other"` avec son `node`.

### `ctx.resolveImport(node)` {#ctx-resolve-import}

Résout n'importe quel nœud du programme vers l'import dont il vient. Renvoie un `binding`, ou `null`. Utilisez-le sur un nœud trouvé avec `ctx.walk`. Le nœud est retrouvé par son `type`, son `start` et son `end`. Un identifiant, un accès à un membre, un appel ou une chaîne peut se résoudre. Tout autre nœud donne `null`.

### `ctx.walk(visit)` {#ctx-walk}

Visite chaque nœud du programme. `visit(node, parent)` reçoit le nœud et son parent, ou `null` à la racine. Renvoyez `"skip"` pour ignorer les enfants de ce nœud. Un nœud expose `type`, `start` et `end`. Tous les autres champs sont `unknown`.

### `ctx.raise(code, at, what, options?)` {#ctx-raise}

Arrête le build. Lève une erreur avec votre `code`, construite à partir de `what`. L'erreur porte le fichier, la ligne et la colonne de `at.start`. L'appel ne revient jamais.

`options.composable` nomme l'API en échec. `options.hint` ajoute une piste de correction, affichée hors build de production.

Le code doit avoir la forme `NAMESPACE:REASON`. Utilisez des majuscules, des chiffres et `_`, avec exactement un `:`. Un préfixe du framework, ou un code qui n'a pas cette forme, est refusé avec `VITE:TRANSFORM_UNSUPPORTED`. Voir [Erreurs](#errors).

### `ctx.warn(code, at, what, options?)` {#ctx-warn}

Écrit un avertissement avec le même emplacement, sans arrêter le build. Les mêmes règles s'appliquent au code et aux options.

### `ctx.emitAsset(name, source)` {#ctx-emit-asset}

Ajoute un fichier à la sortie du build et renvoie son nom. Fonctionne uniquement dans un build. Dans `vite dev`, elle lève `VITE:TRANSFORM_UNSUPPORTED`.

### `name` {#transform-name}

Le nom de la transformation : `<namespace>:<transform>`, en minuscules. Chaque partie commence par une lettre, puis contient des lettres, des chiffres et `-`. Le namespace `gwen` est réservé aux transformations intégrées. Deux transformations ne peuvent pas porter le même nom.

`kit.addSourceTransform` vérifie le nom quand le module s'initialise. Un mauvais nom échoue aussitôt avec `KIT:SOURCE_TRANSFORM_INVALID`.

### `run(program, ctx)` {#transform-run}

Reçoit le nœud racine du programme et le contexte. Renvoie un tableau de modifications, ou une promesse de tableau.

Une modification est de l'un de ces trois types :

- `{ kind: "insert", at, text }` ajoute du texte à un offset.
- `{ kind: "overwrite", start, end, text }` remplace une plage.
- `{ kind: "remove", start, end }` supprime une plage.

Le pipeline vérifie chaque modification. Une modification invalide échoue avec `VITE:TRANSFORM_UNIT_FAILED` et le message `Transform "<name>" failed on <id>.`. Sa `cause` contient l'un de ces messages :

- `edit is not an object.`
- `edit kind is not insert, overwrite, or remove.`
- `edit offsets are out of range.` Un offset est un entier entre zéro et la longueur du code source.
- `edit range is empty.` Un overwrite ou un remove demande `start` inférieur à `end`.
- `edit start is after its end.`
- `insert offset is out of range.`
- `insert text is not a string.`
- `overwrite text is not a string.`

Si `run` lève une erreur qui n'est pas une `GwenError`, le pipeline l'encapsule. La cause est conservée.

## Reconnaître les appels {#matching}

`ctx.calls()` liste chaque expression d'appel. Les appels dans les commentaires et les chaînes n'apparaissent jamais, car ce ne sont pas des appels du programme.

`binding` suit l'import, pas le nom que vous avez tapé. Ce code source utilise quatre formes du même import. Un cinquième appel a un nom local qui masque l'import.

```ts
import { defineTint as paint } from "@example/tint";
import * as tint from "@example/tint";
import { defineTint } from "./barrel.js";

export const aliased = paint("red");
export const namespaced = tint.defineTint("green");
export const barreled = defineTint("blue");

export function shadowed(defineTint) {
  return defineTint("red");
}

export function dynamic(color) {
  return defineTint(color);
}
```

Ici `barrel.js` contient `export { defineTint } from "@example/tint";`. Le plugin `tint` donne ce résultat :

| Source | Résultat |
|--------|----------|
| `paint("red")` | `16711680` |
| `tint.defineTint("green")` | `65280` |
| `defineTint("blue")` depuis le barrel | `255` |
| `defineTint("red")` sur un paramètre nommé `defineTint` | inchangé |
| `defineTint(color)` | inchangé |

Les règles, en bref :

- Un alias se résout vers le nom importé. `paint` donne `imported: "defineTint"`.
- Un membre de namespace, comme `tint.defineTint`, se résout quand l'accès n'est ni calculé ni optionnel.
- Un fichier barrel du projet (un chemin relatif ou un alias Vite, dans la racine) qui réexporte le nom est suivi jusqu'à son origine, jusqu'à une profondeur fixe. Un import de namespace d'un barrel n'est pas suivi.
- Un nom utilisé sans aucune déclaration se résout par les auto-imports, quand l'un le déclare.
- Un appel optionnel, comme `defineTint?.("red")`, n'a pas de binding.
- Un nom local qui masque l'import n'a pas de binding.
- Un import de type seul n'a pas de binding. Les imports de type seul sont absents de la table des imports.
- Un appel dont l'appelé n'est pas un import a `binding: null`. Il apparaît quand même dans la liste.

Une transformation qui s'appuie sur `binding` traite toutes les formes avec un seul test. Une transformation qui s'appuie sur le nom de l'appelé en rate la plupart.

## Ordre {#ordering}

Le pipeline construit sa liste de transformations en trois groupes :

1. Les transformations intégrées du framework.
2. Les transformations enregistrées par les modules, dans l'ordre des modules.
3. Les unités que d'autres plugins Vite enregistrent sur le pipeline avant le début du build.

L'ordre des modules est l'ordre de `modules` dans `gwen.config.ts`, puis les modules de `src/modules`. Les modules du framework passent en premier. Un nom de module n'est utilisé qu'une fois : un second module avec le même `meta.name` est ignoré.

La liste est figée à `buildStart`. Une transformation enregistrée après ce moment est refusée avec `VITE:TRANSFORM_UNSUPPORTED`.

L'ordre compte rarement. Les transformations ne voient jamais le résultat des autres, donc seuls les offsets décident. Quand deux insertions tombent sur le même offset, la transformation placée plus tôt dans la liste vient en premier dans la sortie.

## Erreurs {#errors}

| Code | Levée quand | Message |
|------|-------------|---------|
| [`KIT:SOURCE_TRANSFORM_INVALID`](/fr/api/errors#kit-source-transform-invalid) | Le nom n'est pas `<namespace>:<transform>` en minuscules, le namespace est `gwen`, ou `run` n'est pas une fonction. | `Source transform "<name>" is invalid: <reason>.` |
| [`KIT:SOURCE_TRANSFORM_DUPLICATE`](/fr/api/errors#kit-source-transform-duplicate) | Un nom est enregistré deux fois. | `Source transform "<name>" is already registered by module "<first>".` |
| [`VITE:TRANSFORM_PARSE_FAILED`](/fr/api/errors#vite-transform-parse-failed) | L'analyseur rejette le module. | `<id>:<line>:<column> <message>.` |
| [`VITE:TRANSFORM_EDIT_CONFLICT`](/fr/api/errors#vite-transform-edit-conflict) | Deux modifications touchent la même plage. | `<a> [s-e] and <b> [s-e] edit the same range in <id>.` |
| [`VITE:TRANSFORM_UNSUPPORTED`](/fr/api/errors#vite-transform-unsupported) | Une transformation lève ou signale un code au préfixe du framework ou un code qui n'est pas `NAMESPACE:REASON`, appelle `emitAsset` hors d'un build, s'enregistre après `buildStart`, ou enregistre un nom qu'une autre unité porte déjà. | Un message par cause, voir la liste sous le tableau. |
| [`VITE:TRANSFORM_UNIT_FAILED`](/fr/api/errors#vite-transform-unit-failed) | Une modification est invalide, ou `run` lance une erreur qui n'est pas une `GwenError`. | `Transform "<name>" failed on <id>.` |
| `TINT:UNKNOWN_COLOR` | L'exemple reçoit une couleur qu'il ne connaît pas. | `Unknown tint color "<value>".` |

La dernière ligne est le code de l'exemple. C'est à vous de définir le vôtre. Les autres lignes sont des codes du framework ; suivez chaque lien pour la cause et la correction.

Chaque cellule Message est la partie `what`. Le message complet est `[<composable>()] <what>`, ou `[GWEN] <what>` quand aucun composable n'est défini. Vient ensuite une ligne `Fix:` facultative, puis une ligne `See`.

`VITE:TRANSFORM_UNSUPPORTED` a un message pour chaque cause :

- Un code au préfixe du framework, ou qui n'est pas `NAMESPACE:REASON` : `Transform "<name>" raised "<code>", which is not one of its own codes.`
- `ctx.emitAsset` hors d'un build : `emitAsset is only available in a build.`
- Un enregistrement après `buildStart` : `register() was called after buildStart.`
- Un nom qu'une autre unité porte déjà : `register() was called with a different unit named <name>.`

Les raisons de `KIT:SOURCE_TRANSFORM_INVALID` sont :

- `the name must be "<namespace>:<transform>" in lower case`
- `the "gwen:" namespace is reserved for built-in transforms`
- `run is not a function`

Un code que vous levez avec `raise` ou signalez avec `warn` doit suivre `NAMESPACE:REASON`. Ces préfixes appartiennent au framework et sont refusés : `CORE`, `SCHEMA`, `KIT`, `APP`, `VITE`, `MATH`, `RENDERER`, `CAMERA`, `PHYSICS2D`, `PHYSICS3D` et `CONFORMANCE`. Choisissez votre propre préfixe, comme l'exemple avec `TINT`.

## Tester une transformation {#testing}

Testez une transformation sur le vrai pipeline. Un contexte construit à la main ne prouve ni les règles de reconnaissance, ni les offsets, ni l'emplacement de l'erreur.

Le dépôt fait ainsi dans `packages/vite/tests/transform-pipeline/kit-transform.test.ts` :

1. Créez un projet temporaire avec un dossier `src`, un `gwen.config.ts` et votre module.
2. Appelez `gwen()` depuis `@gwenjs/vite`. Un test peut l'importer, un plugin non. Lancez le hook `config` du plugin `gwen` avec la racine du projet. Il charge votre module et enregistre sa transformation.
3. Passez le plugin `gwen:transform-pipeline` au `createServer` de Vite, avec `appType: "custom"` et `server: { middlewareMode: true }`.
4. Écrivez un fichier source, appelez `server.transformRequest` dessus, puis lisez `result.code`.
5. Vérifiez le nouveau code. Pour un échec, attrapez l'erreur et vérifiez son code, son emplacement, et le texte `what` dans son message.
6. Fermez le serveur et supprimez le projet dans `finally`.

La page que vous lisez est testée de la même façon. Un test Vite écrit les deux fichiers ci-dessus dans un projet et passe le code source d'exemple de la section sur la reconnaissance dans le pipeline.

## Limites {#limits}

- Une transformation n'importe jamais `@gwenjs/vite`. Elle n'a pas non plus besoin d'analyseur : le programme et le contexte suffisent.
- `gwenVitePlugin()` exécute seulement les transformations intégrées. Il ne charge pas les modules, donc une transformation du kit ne passe pas par lui. Utilisez `gwen()`.
- `ctx.emitAsset` fonctionne uniquement dans un build.
- Un code levé avec `raise` ou signalé avec `warn` au préfixe du framework est refusé.
- Les noms du namespace `gwen:` sont réservés.
- Une transformation modifie seulement le code source d'origine. Elle ne peut ni lire ni changer ce qu'une autre a écrit.

Voir [Créer un module](/fr/kit/custom-module) pour le reste de l'API `kit` et [Erreurs](/fr/api/errors) pour tous les codes d'erreur.

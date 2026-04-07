---
title: "@gwenjs/physics3d-fracture"
description: "Référence API pour @gwenjs/physics3d-fracture."
---

# @gwenjs/physics3d-fracture

`pnpm add @gwenjs/physics3d-fracture`

Module de fracture Voronoi pour maillages triangulaires 3D, compilé en WebAssembly. À partir d'un maillage et d'un point d'impact, il partitionne la géométrie en un nombre configurable de fragments. Le module est chargé à l'exécution via `engine.loadWasmModule()` et ne dépend pas de `@gwenjs/core`.

## Installation

```bash
pnpm add @gwenjs/physics3d-fracture
```

Le binaire WASM est embarqué avec le package. Aucune configuration de plugin Vite supplémentaire n'est requise.

## Initialisation

### initFracture(module_or_path?)

**Signature:**
```ts
export default function initFracture(
  module_or_path?: InitInput | Promise<InitInput>
): Promise<InitOutput>
```

**Description.** Initialise le module WASM de façon asynchrone. À appeler une seule fois avant d'utiliser `voronoi_fracture`. Accepte un chemin optionnel vers le fichier `.wasm` ou une `Response`/`ArrayBuffer` déjà récupérée. Si omis, le chemin par défaut résolu par le bundler est utilisé.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| module_or_path | `InitInput \| Promise<InitInput>` | Source WASM optionnelle |

**Retourne:** `Promise<InitOutput>` — instance du module résolue une fois le WASM prêt.

**Exemple:**
```ts
import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture'

await initFracture()
// module prêt — voronoi_fracture peut maintenant être appelée
```

### initSync(input)

**Signature:**
```ts
function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput
```

**Description.** Initialise le module WASM de façon synchrone. Nécessite que les octets `.wasm` soient déjà disponibles en mémoire (par exemple récupérés ou intégrés). Utile dans les environnements où `await` au niveau supérieur n'est pas disponible.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| module | `{ module: SyncInitInput } \| SyncInitInput` | Octets WASM pré-chargés |

**Retourne:** `InitOutput` — instance du module.

**Exemple:**
```ts
import { initSync, voronoi_fracture } from '@gwenjs/physics3d-fracture'
import wasmBytes from '@gwenjs/physics3d-fracture/wasm?arraybuffer'

initSync(wasmBytes)
// module prêt
```

## Fonctions

### voronoi_fracture(vertices_flat, indices_flat, impact_x, impact_y, impact_z, shard_count, seed)

**Signature:**
```ts
function voronoi_fracture(
  vertices_flat: Float32Array,
  indices_flat: Uint32Array,
  impact_x: number,
  impact_y: number,
  impact_z: number,
  shard_count: number,
  seed: number
): Float32Array
```

**Description.** Fracture un maillage triangulaire en jusqu'à `shard_count` fragments à l'aide de l'affectation de sites Voronoi. Les sites sont distribués autour du point d'impact en utilisant la graine LCG fournie pour la reproductibilité. Seuls les fragments non vides sont inclus dans le buffer de sortie.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| vertices_flat | `Float32Array` | Positions de sommets entrelacées : `[x0, y0, z0, x1, y1, z1, ...]` |
| indices_flat | `Uint32Array` | Indices de triangles : `[a0, b0, c0, a1, b1, c1, ...]` |
| impact_x | `number` | Coordonnée X du point d'impact dans l'espace local du maillage |
| impact_y | `number` | Coordonnée Y du point d'impact dans l'espace local du maillage |
| impact_z | `number` | Coordonnée Z du point d'impact dans l'espace local du maillage |
| shard_count | `number` | Nombre de fragments souhaités (plage recommandée : 1–64) |
| seed | `number` | Graine aléatoire LCG pour des motifs de fracture reproductibles |

**Retourne:** `Float32Array` — buffer `f32` plat encodant tous les fragments non vides. L'appelant est responsable de l'interprétation de la disposition des fragments dans le buffer (voir [Notes](#notes)).

**Exemple:**
```ts
import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture'

await initFracture()

// Construction d'un cube unité simple (disposition SoA plate attendue par le module WASM)
const vertices = new Float32Array([
  -0.5, -0.5, -0.5,
   0.5, -0.5, -0.5,
   0.5,  0.5, -0.5,
  -0.5,  0.5, -0.5,
  -0.5, -0.5,  0.5,
   0.5, -0.5,  0.5,
   0.5,  0.5,  0.5,
  -0.5,  0.5,  0.5,
])

const indices = new Uint32Array([
  0, 1, 2,  0, 2, 3, // face -Z
  4, 6, 5,  4, 7, 6, // face +Z
  0, 4, 5,  0, 5, 1, // face -Y
  2, 6, 7,  2, 7, 3, // face +Y
  0, 3, 7,  0, 7, 4, // face -X
  1, 5, 6,  1, 6, 2, // face +X
])

// Fracture au centre avec 8 fragments, graine 42
const shardBuffer = voronoi_fracture(
  vertices,
  indices,
  0.0, 0.0, 0.0, // point d'impact
  8,             // nombre de fragments
  42             // graine
)

console.log('Longueur du buffer de sortie :', shardBuffer.length)
```

**Intégration avec le moteur :**
```ts
import { defineSystem, onUpdate, useQuery } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'
import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture'

// Initialiser le module WASM une seule fois au démarrage
await initFracture()

export const FractureSystem = defineSystem(function FractureSystem() {
  const engine = useEngine()
  const targets = useQuery([MeshData, Breakable])

  onUpdate(() => {
    for (const id of targets) {
      if (!Breakable.triggered[id]) continue

      const vertices = new Float32Array(MeshData.verticesBuffer[id])
      const indices = new Uint32Array(MeshData.indicesBuffer[id])

      const shards = voronoi_fracture(
        vertices,
        indices,
        Breakable.impactX[id],
        Breakable.impactY[id],
        Breakable.impactZ[id],
        16,  // nombre de fragments
        Math.floor(Math.random() * 0xffffffff)
      )

      // traitement des fragments...
      Breakable.triggered[id] = 0
    }
  })
})
```

## Types

### InitInput

```ts
type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module
```

Formes acceptées pour la source WASM passée à `initFracture`. Le plus souvent une URL sous forme de chaîne ou une `Response` de `fetch`.

### SyncInitInput

```ts
type SyncInitInput = BufferSource | WebAssembly.Module
```

Formes acceptées pour l'initialiseur synchrone `initSync`. Doit déjà être en mémoire — aucune requête réseau n'est effectuée.

### InitOutput

```ts
interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly voronoi_fracture: (
    vertices_flat: number,
    indices_flat: number,
    impact_x: number,
    impact_y: number,
    impact_z: number,
    shard_count: number,
    seed: number
  ) => number
}
```

Exports WASM bruts retournés par `initFracture` ou `initSync`. En utilisation normale, préférer le wrapper typé `voronoi_fracture` exporté directement depuis le package plutôt que d'appeler la version brute basée sur les pointeurs depuis `InitOutput`.

## Notes

- **Plage de shard_count.** Les valeurs entre 1 et 64 sont recommandées. Des valeurs plus élevées augmentent le temps de calcul et peuvent produire des fragments dégénérés (vides) automatiquement exclus de la sortie.
- **Disposition du buffer de sortie.** Le `Float32Array` retourné encode tous les fragments non vides séquentiellement. Chaque fragment est représenté comme une liste plate de positions de sommets (triplets x, y, z) formant sa géométrie triangulée. Aucun buffer d'indices n'est retourné — chaque trois valeurs forment un sommet, chaque neuf valeurs forment un triangle. Un en-tête de délimitation de fragment peut être ajouté avant chaque fragment selon la version ; consulter le changelog du package pour la disposition exacte de la version installée.
- **Reproductibilité.** Passer le même entier `seed` avec le même maillage et le même point d'impact garantit un buffer de sortie identique entre les appels et les plateformes.
- **Espace local du maillage.** Les coordonnées d'impact sont attendues dans l'espace local du maillage, pas en espace monde. Appliquer l'inverse de la transformation du maillage avant de passer des coordonnées en espace monde.
- **Sécurité des threads.** Le module WASM n'est pas thread-safe. Ne pas appeler `voronoi_fracture` en concurrence depuis plusieurs workers partageant la même instance `InitOutput`.

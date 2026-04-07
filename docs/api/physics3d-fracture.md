---
title: "@gwenjs/physics3d-fracture"
description: "API reference for @gwenjs/physics3d-fracture."
---

# @gwenjs/physics3d-fracture

`pnpm add @gwenjs/physics3d-fracture`

Voronoi fracture module for 3D triangle meshes, compiled to WebAssembly. Given a mesh and an impact point, it partitions the geometry into a configurable number of shards. The module is loaded at runtime via `engine.loadWasmModule()` and does not depend on `@gwenjs/core`.

## Installation

```bash
pnpm add @gwenjs/physics3d-fracture
```

The WASM binary is bundled alongside the package. No additional Vite plugin configuration is required.

## Initialization

### initFracture(module_or_path?)

**Signature:**
```ts
export default function initFracture(
  module_or_path?: InitInput | Promise<InitInput>
): Promise<InitOutput>
```

**Description.** Asynchronously initializes the WASM module. Call this once before using `voronoi_fracture`. Accepts an optional path to the `.wasm` file or a pre-fetched `Response`/`ArrayBuffer`. If omitted, the bundler-resolved default path is used.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| module_or_path | `InitInput \| Promise<InitInput>` | Optional WASM source override |

**Returns:** `Promise<InitOutput>` — resolved module instance once WASM is ready.

**Example:**
```ts
import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture'

await initFracture()
// module is ready — voronoi_fracture can now be called
```

### initSync(input)

**Signature:**
```ts
function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput
```

**Description.** Synchronously initializes the WASM module. Requires the `.wasm` bytes to already be available in memory (e.g. fetched or inlined). Useful in environments where top-level `await` is not available.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| module | `{ module: SyncInitInput } \| SyncInitInput` | Pre-loaded WASM bytes |

**Returns:** `InitOutput` — module instance.

**Example:**
```ts
import { initSync, voronoi_fracture } from '@gwenjs/physics3d-fracture'
import wasmBytes from '@gwenjs/physics3d-fracture/wasm?arraybuffer'

initSync(wasmBytes)
// module is ready
```

## Functions

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

**Description.** Fractures a triangle mesh into up to `shard_count` pieces using Voronoi site assignment. Sites are distributed around the impact point using the provided LCG seed for reproducibility. Only non-empty shards are included in the output buffer.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| vertices_flat | `Float32Array` | Interleaved vertex positions: `[x0, y0, z0, x1, y1, z1, ...]` |
| indices_flat | `Uint32Array` | Triangle indices: `[a0, b0, c0, a1, b1, c1, ...]` |
| impact_x | `number` | Impact point X coordinate in local mesh space |
| impact_y | `number` | Impact point Y coordinate in local mesh space |
| impact_z | `number` | Impact point Z coordinate in local mesh space |
| shard_count | `number` | Desired number of shards (recommended range: 1–64) |
| seed | `number` | LCG random seed for reproducible fracture patterns |

**Returns:** `Float32Array` — flat `f32` buffer encoding all non-empty shards. The caller is responsible for interpreting the shard layout from the buffer (see [Notes](#notes)).

**Example:**
```ts
import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture'

await initFracture()

// Build a simple unit cube mesh (flat SoA layout expected by the WASM module)
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
  0, 1, 2,  0, 2, 3, // -Z face
  4, 6, 5,  4, 7, 6, // +Z face
  0, 4, 5,  0, 5, 1, // -Y face
  2, 6, 7,  2, 7, 3, // +Y face
  0, 3, 7,  0, 7, 4, // -X face
  1, 5, 6,  1, 6, 2, // +X face
])

// Fracture at the center with 8 shards, seed 42
const shardBuffer = voronoi_fracture(
  vertices,
  indices,
  0.0, 0.0, 0.0, // impact point
  8,             // shard count
  42             // seed
)

console.log('Output buffer length:', shardBuffer.length)
```

**Integration with the engine:**
```ts
import { defineSystem, onUpdate, useQuery } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'
import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture'

// Initialize the WASM module once at startup
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
        16,  // shard count
        Math.floor(Math.random() * 0xffffffff)
      )

      // process shards...
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

Accepted forms for the WASM source passed to `initFracture`. Most commonly a URL string or a `fetch` `Response`.

### SyncInitInput

```ts
type SyncInitInput = BufferSource | WebAssembly.Module
```

Accepted forms for the synchronous initializer `initSync`. Must already be in memory — no network fetch is performed.

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

Raw WASM exports returned by `initFracture` or `initSync`. In normal usage, prefer the typed wrapper `voronoi_fracture` exported directly from the package rather than calling the raw pointer-based version from `InitOutput`.

## Notes

- **shard_count range.** Values between 1 and 64 are recommended. Higher values increase computation time and may produce degenerate (empty) shards that are automatically excluded from the output.
- **Output buffer layout.** The returned `Float32Array` encodes all non-empty shards sequentially. Each shard is represented as a flat list of vertex positions (x, y, z triplets) forming its triangulated geometry. No index buffer is returned — every three values form one vertex, every nine values form one triangle. A shard boundary header may be prepended per shard depending on the version; check the package changelog for the exact layout of your installed version.
- **Reproducibility.** Passing the same `seed` integer with the same mesh and impact point guarantees an identical output buffer across calls and platforms.
- **Local mesh space.** The impact coordinates are expected in the mesh's local space, not world space. Apply the inverse of the mesh transform before passing world-space coordinates.
- **Thread safety.** The WASM module is not thread-safe. Do not call `voronoi_fracture` concurrently from multiple workers sharing the same `InitOutput` instance.

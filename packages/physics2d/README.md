# @gwenjs/physics2d

2D physics plugin for GWEN (Rapier2D + WASM).

This documentation is plugin-specific, not engine-wide.

## Installation

```bash
pnpm add @gwenjs/physics2d
```

## Quick start

```ts
import { defineConfig } from '@gwenjs/kit';
import { physics2D } from '@gwenjs/physics2d';

export default defineConfig({
  plugins: [
    physics2D({
      gravity: -9.81,
      gravityX: 0,
      maxEntities: 10000,
      qualityPreset: 'medium',
      eventMode: 'pull',
      coalesceEvents: true,
    }),
  ],
});
```

## What the plugin provides

- `physics` service (runtime API): bodies, colliders, velocity, impulses, collision batches.
- Global hooks: `physics:collision`, `physics:collision:batch`, `physics:sensor:changed`.
- Prefab extension `extensions.physics` with legacy bridge + vNext `colliders[]`.
- Material presets: `default`, `ice`, `rubber`.
- Tilemap helpers and chunk streaming runtime.
- Systems: `createPhysicsKinematicSyncSystem()` and `createPlatformerGroundedSystem()`.

## Tree-shakable imports (Sprint 8)

```ts
import { physics2D } from '@gwenjs/physics2d/core';
import { buildTilemapPhysicsChunks } from '@gwenjs/physics2d/tilemap';
import { PHYSICS_MATERIAL_PRESETS } from '@gwenjs/physics2d/debug';
```

Available entry points:

- `@gwenjs/physics2d` (full)
- `@gwenjs/physics2d/core`
- `@gwenjs/physics2d/helpers`
- `@gwenjs/physics2d/helpers/queries`
- `@gwenjs/physics2d/helpers/movement`
- `@gwenjs/physics2d/helpers/contact`
- `@gwenjs/physics2d/helpers/static-geometry`
- `@gwenjs/physics2d/helpers/orchestration`
- `@gwenjs/physics2d/tilemap`
- `@gwenjs/physics2d/debug`

### Helpers quick examples

```ts
import { getSpeed } from '@gwenjs/physics2d/helpers/queries';
import { applyDirectionalImpulse } from '@gwenjs/physics2d/helpers/movement';
import { createTilemapChunkOrchestrator } from '@gwenjs/physics2d/helpers/orchestration';
```

## Key config options

- `qualityPreset?: 'low' | 'medium' | 'high' | 'esport'`
- `ccdEnabled?: boolean` (global fallback)
- `coalesceEvents?: boolean`
- `eventMode?: 'pull' | 'hybrid'`
- `compat?: { legacyPrefabColliderProps?: boolean; legacyCollisionJsonParser?: boolean }`

## Recommended runtime pattern

1. Declare physics in prefabs with `extensions.physics.colliders[]`.
2. Prefer `physics.getCollisionContacts()` in gameplay systems (EntityId-first).
3. For one-entity filtering, use `getEntityCollisionContacts(physics, entityId)` from `@gwenjs/physics2d/helpers/contact`.
4. Use `physics.getCollisionEventsBatch()` when raw slot-level diagnostics are needed.
5. Use tilemap chunk helpers for large maps; patch chunks incrementally.

## Prefab example (vNext)

```ts
import { definePrefab } from '@gwenjs/core';

export const BulletPrefab = definePrefab({
  name: 'Bullet',
  extensions: {
    physics: {
      bodyType: 'dynamic',
      ccdEnabled: true,
      colliders: [{ shape: 'ball', radius: 4 }],
      onCollision(self, _other, contact, api) {
        if (!contact.started) return;
        api.destroyEntity(self);
      },
    },
  },
  create: (api, x: number, y: number) => {
    const id = api.createEntity();
    api.addComponent(id, 'position', { x, y });
    return id;
  },
});
```

## Documentation index

- API: `docs/API.md`
- Migration: `docs/MIGRATION.md`
- Tilemap: `docs/TILEMAP.md`
- Hooks: `docs/hooks.md`
- Systems: `docs/systems.md`

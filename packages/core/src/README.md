# 🏗️ Engine-Core Source Structure

**Last Updated:** March 3, 2026
**Restructure Version:** 2.0 (Phase 1 + Phase 2)

## Overview

The `engine-core/src` folder is now organized into **logical domains** instead of a flat structure. This improves maintainability, scalability, and developer experience.

**Before:** 14 files flat (3453 lines)
**After:** 19 files in 6 folders (3453 lines)

## Folder Structure

```
src/
├── core/                          # ECS Fundamentals
│   ├── ecs.ts                     # Entity/Component/Query management
│   ├── prefab.ts                  # Prefab system
│   └── (schema.ts is at root)
│
├── config/                        # Configuration System
│   └── config.ts                  # defineConfig, merging, validation
│
├── plugin-system/                 # Plugin Infrastructure
│   ├── plugin.ts                  # GwenPlugin type system, createPlugin()
│   └── plugin-manager.ts          # Plugin lifecycle management
│
├── engine/                        # Engine Orchestration (Main Cluster)
│   ├── engine.ts                  # Main Engine class (550L)
│   │                              # - Entity/component management
│   │                              # - Query system
│   │                              # - Plugin registration
│   │                              # - Stats & debug
│   │                              # - Event system
│   ├── engine-api.ts              # Shims & utilities (170L)
│   │                              # - EntityManagerShim, ComponentRegistryShim
│   │                              # - packId/unpackId helpers
│   │                              # - createShims() factory
│   ├── engine-global.ts           # Global singleton (30L)
│   │                              # - getEngine(), useEngine(), resetEngine()
│   ├── engine-lifecycle.ts        # Lifecycle helpers (30L) [for future]
│   │                              # - start(), stop() delegators
│   └── wasm-bridge.ts             # WASM integration (361L)
│                                  # - WasmBridge interface
│                                  # - initWasm(), getWasmBridge()
│
├── api/                           # High-Level APIs
│   ├── api.ts                     # ServiceLocator, EngineAPI
│   ├── scene.ts                   # SceneManager, defineScene()
│   └── ui.ts                      # UIManager, defineUI()
│
├── utils/                         # Utilities
│   └── string-pool.ts             # String interning for performance
│
└── Root Level (Shared)
    ├── index.ts                   # Central export barrel
    ├── types.ts                   # Shared type definitions
    ├── schema.ts                  # Component schema DSL
    └── README.md                  # This file
```

## File Responsibilities

### core/

**Purpose:** ECS fundamentals - the foundation of the engine

- **ecs.ts:** Entity manager, component registry, query engine
- **prefab.ts:** Prefab definitions and manager
- **schema.ts:** Component schema definition and layout computation

### config/

**Purpose:** Configuration handling

- **config.ts:** defineConfig(), config merging, validation

### plugin-system/

**Purpose:** Plugin infrastructure

- **plugin.ts:** GwenPlugin type system with generics
- **plugin-manager.ts:** Plugin registration, lifecycle hooks

### engine/

**Purpose:** Main engine orchestration and state management

- **engine.ts:** Primary Engine class with all public APIs
- **engine-api.ts:** Shims to adapt WASM bridge to ECS interfaces
- **engine-global.ts:** Global singleton (convenience)
- **engine-lifecycle.ts:** Lifecycle delegation (structure for future)
- **wasm-bridge.ts:** WASM module interface

### api/

**Purpose:** High-level consumer APIs

- **api.ts:** ServiceLocator pattern for services
- **scene.ts:** Scene management system
- **ui.ts:** UI component management

### utils/

**Purpose:** Shared utilities

- **string-pool.ts:** String interning for memory efficiency

## Import Patterns

### ✅ Good Patterns

**Within a folder:**

```typescript
// core/prefab.ts importing from core/
import { EntityId } from '../engine';
```

**Cross-folder:**

```typescript
// engine/engine.ts importing from core/
import type { EntityManager } from '../core/ecs';
import { PluginManager } from '../plugin-system/plugin-manager';
```

**From root level:**

```typescript
import type { EngineConfig } from '../types';
import { schema } from '../schema';
```

**External users (via index.ts):**

```typescript
// External package importing
import { Engine, defineConfig } from '@gwenjs/core';
```

### ❌ Avoid

- **Circular imports:** (none should exist - check if adding new code)
- **Importing across multiple levels:** Use root-level exports instead
- **Side effects in imports:** Keep imports pure

## Dependencies

### Dependency Direction (Acyclic)

```
index.ts (exports only)
  ↓
engine/ (orchestrator)
  ├─→ api/
  ├─→ core/
  ├─→ config/
  ├─→ plugin-system/
  └─→ utils/

api/ depends on:
  ├─→ core/
  └─→ types.ts (root)

config/ depends on:
  └─→ types.ts (root)

plugin-system/ depends on:
  └─→ types.ts (root)

core/ depends on:
  └─→ schema.ts (root)

utils/ is autonomous
types.ts & schema.ts are at root (no internal deps)
```

## Scaling Guidance

### Adding New Features

1. **Entity/Component related?** → Add to `core/`
2. **Plugin infrastructure?** → Add to `plugin-system/`
3. **Engine orchestration?** → Add to `engine/`
4. **High-level API (scenes, UI)?** → Add to `api/`
5. **Configuration?** → Add to `config/`
6. **Utility helpers?** → Add to `utils/`

### File Size Guidelines

- **Keep files < 250 lines** for readability
- **If a file exceeds 300L:** Split into focused sub-files
- **Example:** If `scene.ts` grows:
  ```
  api/
  ├── scene.ts (200L)
  ├── scene-types.ts (100L)
  └── scene-plugins.ts (50L)
  ```

## Testing

All test files (`.test.ts`, `.bench.ts`) import from the **public API**:

```typescript
// ✅ Preferred (tests most common usage)
import { Engine, defineConfig } from '@gwenjs/core';

// ✅ OK for internal tests (verify implementation)
import { EntityManager } from '../src/core/ecs';
```

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test --watch     # Watch mode
```

## Migration Notes (If Refactoring Existing Code)

### Old Imports

```typescript
import { Engine } from './engine';
import { EntityManager } from './ecs';
import { PluginManager } from './plugin-manager';
```

### New Imports

```typescript
import { Engine } from './engine/engine';
import { EntityManager } from './core/ecs';
import { PluginManager } from './plugin-system/plugin-manager';
```

### Updating External Packages

**No changes needed!** External packages import from the barrel export:

```typescript
import { Engine } from '@gwenjs/core'; // Still works ✓
```

## Future Improvements

### Potential Next Steps

1. **Split API further** if it grows:
   - `api/scene/`, `api/ui/`, `api/core/`

2. **Add middleware layer** if needed:
   - `middleware/` for request/response pipelines

3. **Extract shared patterns:**
   - `patterns/` for common ECS patterns (systems, queries, etc.)

4. **Performance optimization:**
   - Consider lazy-loading heavy modules

## Questions?

- See **ARCHITECTURE.md** for overall design
- See **tests/** for usage examples
- Check **index.ts** for public API surface

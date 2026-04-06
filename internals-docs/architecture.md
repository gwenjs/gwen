# Architecture Overview

## Two-Layer Design

GWEN uses a layered architecture:

**Rust/WASM Core**
- Physics simulation (Rapier 2D/3D)
- ECS memory layout & iteration
- Transform hierarchy
- Compiled to `.wasm` and imported by TypeScript

**TypeScript Layer**
- Engine API (GwenEngine)
- Plugin system (GwenPlugin)
- Scene management & routing
- Actor system (defineActor, useActor)
- Tween system
- Integration with frameworks (Vue, React)

## Package Structure

### TypeScript Packages (`packages/`)

```
core          — GwenEngine, ECS, plugin system, actor system, 
                scene router, tween system. Main orchestrator.

app           — defineConfig, GwenUserConfig, module system,
                gwen.config.ts loader, app initialization

kit           — definePlugin, defineSystem, defineActor,
                GwenPlugin/GwenSystem/GwenActor interfaces

math          — Vec2, Vec3, Mat4, Quat — zero-allocation math
                utilities with SIMD-friendly layouts

schema        — defineComponent, Type system, component schema
                definitions, type introspection

physics2d     — Physics2DPlugin, usePhysics2D composable,
                Rapier 2D bindings

physics3d     — Physics3DPlugin, usePhysics3D composable,
                Rapier 3D bindings, build-tools feature

vite          — WASM Vite plugin, scene auto-discovery,
                gwen.config.ts loader, dev server integration
```

### Rust Crates (`crates/`)

```
gwen-core     — ECS memory layout (Structure of Arrays),
                transform hierarchy, spatial queries,
                compiled to WASM

gwen-physics3d-fracture — Physics3D with fracture simulation
                          (requires build-tools feature)

gwen-wasm-utils — Utilities for WASM/TS bridge, shared memory,
                  ring buffers
```

## Key Architectural Decisions

### Large File Pattern
`gwen-engine.ts` is intentionally large (~2000+ lines) — V8 inlines function calls within the same compilation unit. Splitting into smaller files caused measurable performance regression on the hot path (significant slowdown when updating ~1000 entities/frame). This is a conscious performance trade-off.

### ECS Memory Layout
- **Structure of Arrays (SoA)** not Array of Structures
- Cache-friendly iteration over components
- WASM bridge marshals SoA data to/from TypeScript

### Frame Loop: 8 Phases
The engine runs updates in this order each frame:

1. **input** — Consume input events, set action state
2. **physics-pre** — Update physics constraints, joints
3. **physics** — Step physics simulation
4. **physics-post** — Process physics results, collisions
5. **update-before** — User systems run before main update
6. **update** — Main user update phase
7. **update-after** — User systems run after main update
8. **render** — Render systems prepare data for graphics

Phase hooks are registered via `engine.on(phase, callback)`.

### WASM Bridge
- Shared memory regions (typed arrays + SharedArrayBuffer)
- Ring buffers for command queues (TS → WASM)
- SoA data mapped directly via typed array views
- Minimal serialization/deserialization overhead

### Plugin System
- Composable: `engine.use(plugin)` registers `GwenPlugin`
- Plugins declare dependencies via `GwenProvides`
- Runtime hooks for framework integration (`useActor`, `useTween`)
- Plugin order matters: later plugins can extend earlier ones

### Actor System
- Instance-based game objects on top of ECS (RFC-011)
- `defineActor()` creates actor class factories
- `defineLayout()` declares actor properties & components
- `defineSceneRouter()` manages actor spawning/destruction
- Composable with `useActor()` composable hook

## RFC Index

Core architectural decisions are documented in RFCs:

| RFC | Title | Summary |
|-----|-------|---------|
| 001 | GwenEngine interface | Core engine factory and API contract |
| 002 | definePlugin | Plugin system factory pattern |
| 003 | Tween system | Animation, sequencing, easing functions |
| 004 | App module system | Config loading, gwen.config.ts, module resolution |
| 005 | Error handling | Typed error classes, composable context |
| 008 | 8-phase frame loop | Frame execution model, WASM bridge details |
| 009 | Physics integration | GwenProvides, hooks, Physics2D/3D design |
| 011 | Actor system | Instance-based game objects on ECS |

## Performance Characteristics

- **ECS iteration**: O(1) iteration per component type (SoA layout)
- **Transform updates**: Hierarchical lazy propagation via bitmask
- **Physics queries**: Delegated to Rapier, O(log n) spatial queries
- **Plugin overhead**: Single dispatch per plugin lifecycle event
- **WASM calls**: Batched via ring buffer; single call per frame phase

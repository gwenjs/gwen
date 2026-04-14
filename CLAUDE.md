# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GWEN is a composable TypeScript-first web game engine with a Rust/WebAssembly core. Component data lives in Structure-of-Arrays layout inside WASM linear memory; systems access it directly with entity IDs.

---

## Absolute rules

These rules apply to every task, without exception, before declaring it done.

### Mandatory validation (in this order)

1. `pnpm format` — oxfmt formatting. If it fails: fix and retry.
2. `pnpm lint` — linting. If it fails: fix and retry.
3. `pnpm typecheck` — type checking. If it fails: fix and retry.
4. `pnpm test` — tests. If it fails: fix and retry.

Never announce a task is done before all 4 commands pass without errors.

---

## Repository structure

```
packages/           # TypeScript packages (@gwenjs/*)
  core/             # ECS engine, components, systems, actors, scenes, router
  app/              # Engine bootstrap and defineConfig()
  kit/              # Plugin and module authoring API (definePlugin, defineGwenModule)
  schema/           # Component schema primitives and shared types/hooks interfaces
  math/             # Vectors, quaternions, colors, springs
  physics2d/        # 2D rigid-body physics (Rapier via WASM)
  physics3d/        # 3D rigid-body physics (Rapier via WASM)
  vite/             # Vite plugin — WASM bundling, actor/system name injection, optimizer
crates/             # Rust source (ECS + physics WASM)
  gwen-core/        # Core ECS engine in Rust
  gwen-wasm-utils/  # WASM build utilities
  gwen-physics3d-fracture/
docs/               # VitePress documentation site
```

## Key development commands

```sh
pnpm dev                          # start all TS packages in watch mode (+ Rust watcher)
pnpm test:ts                      # TypeScript tests only (skip Rust)
pnpm test:cargo                   # Rust tests only
pnpm lint:fix                     # auto-fix lint issues
pnpm docs:dev                     # start documentation site locally
```

To run a single test file within a package:
```sh
cd packages/core && pnpm exec vitest run src/path/to/file.test.ts
# or from repo root:
pnpm --filter @gwenjs/core exec vitest run src/path/to/file.test.ts
```

To rebuild WASM (requires Rust toolchain):
```sh
pnpm build:wasm    # production WASM
pnpm build:wasm:tools  # WASM build tools
```

---

## Architecture: layered ECS

```
Game code (TypeScript)
  └─ @gwenjs/core         — ECS, components, systems, actors, scenes
       ├─ /system         — defineSystem, onUpdate, useQuery
       ├─ /actor          — defineActor, definePrefab, onStart, onDestroy
       └─ /scene          — defineScene, defineSceneRouter, useSceneRouter
  └─ @gwenjs/kit          — definePlugin, defineGwenModule (authoring)
  └─ @gwenjs/app          — defineConfig, createEngine bootstrap
  └─ @gwenjs/vite         — Vite plugin (WASM, auto-imports, name injection)
                              WASM bridge
gwen_core.wasm (Rust)     — ECS engine, SoA linear memory, Rapier physics
```

The `@gwenjs/vite` plugin handles critical code transforms at build time:
- Injects readable system/actor names for devtools
- Auto-discovers actors in `src/actors/` and scenes in `src/scenes/`
- Generates virtual modules (`virtual:gwen/actors`, etc.)
- Bundles and serves the WASM binary
- Rewrites async context for actor lifecycle

---

## useQuery

**Signature :** `useQuery(components: ComponentDef[]): LiveQuery`

```ts
// ✅ CORRECT
const entities = useQuery([Position, Velocity])

// ❌ FAUX — forme objet inexistante
const entities = useQuery({ with: [Position, Velocity] })

// ❌ FAUX — deuxième argument inexistant
const entities = useQuery([Health], { exclude: [DeadTag] })
const entities = useQuery([Health], { onChange: ... })
```

- Un seul argument : un tableau de composants
- Pas de `{ with: }`, pas de `{ exclude: }`, pas de `{ onChange: }`
- Doit être appelé dans la **phase setup** (pas à l'intérieur d'un `onUpdate`)

---

## defineScene

**Signature :** `defineScene(name: string, setup: () => void): SceneFactory`

```ts
// ✅ CORRECT — forme unique, tout par composables
export const GameScene = defineScene('game', () => {
  useSystem([MovementSystem, RenderSystem])

  const player = useActor(PlayerActor)
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})

// ❌ FAUX — forme objet supprimée
export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, RenderSystem],
})

// ❌ FAUX — la factory ne retourne rien
export const GameScene = defineScene('game', () => ({
  systems: [MovementSystem],
}))
```

Composables disponibles dans la factory :

| Composable | Rôle |
|---|---|
| `useSystem([...plugins])` | Déclare les systèmes actifs pour cette scène |
| `onEnter(cb)` | Callback déclenché quand la scène devient active |
| `onExit(cb)` | Callback déclenché quand la scène est quittée |

Composables engine également disponibles dans la factory (contexte engine actif) :
- `useEngine()`, `useActor()`, `usePrefab()`, `useSceneRouter()`

---

## Accès aux données de composant

Les composants utilisent le format Structure-of-Arrays (SoA). Accès par entity ID :

```ts
// ✅ CORRECT
for (const id of entities) {
  Position.x[id] += Velocity.x[id] * dt
}

// ❌ FAUX — les entités ne sont pas des objets
for (const entity of entities) {
  entity.get(Position)
  entity.transform.x += ...
}
```

---

## addComponent / removeComponent

Ce sont des **méthodes de l'engine**, pas des exports standalone :

```ts
// ✅ CORRECT
const engine = useEngine()
engine.addComponent(entityId, Position, { x: 10, y: 20 })
engine.removeComponent(entityId, Velocity)

// ❌ FAUX — ces exports n'existent pas
import { addComponent, removeComponent } from '@gwenjs/core'
```

---

## defineSceneRouter

```ts
// ✅ CORRECT — clé 'routes'
defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: { START: 'game' } },
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
  },
})

// ❌ FAUX — clé 'scenes' inexistante
defineSceneRouter({ initial: 'menu', scenes: { ... } })
```

---

## useSceneRouter

```ts
// ✅ CORRECT — prend le routerDef en argument
const nav = useSceneRouter(AppRouter)
await nav.send('START')
nav.can('START')
nav.current
nav.params

// ❌ FAUX — sans argument
const router = useSceneRouter()
router.goTo('Game')  // .goTo() n'existe pas
```

Imports :
- `defineSceneRouter` → `@gwenjs/core/scene`
- `useSceneRouter` → `@gwenjs/core/scene` (pas `@gwenjs/core/actor`)

---

## defineActor

**Signature :** `defineActor(prefab: PrefabDefinition, factory: (props?) => PublicAPI)`

```ts
// ✅ CORRECT
export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  onStart(() => { ... })
  onUpdate((dt) => { ... })
  onDestroy(() => { ... })
  return { takeDamage: (n: number) => { ... } }
})

// Spawn / despawn via _plugin
await engine.use(EnemyActor._plugin)
const id = EnemyActor._plugin.spawn({ hp: 100 })
EnemyActor._plugin.despawn(id)

// ❌ FAUX — forme objet inexistante
defineActor({ name: 'Enemy', setup() { ... } })
```

---

## definePrefab

```ts
// ✅ CORRECT — tableau de { def, defaults }
export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { hp: 100 } },
])

// ❌ FAUX — forme objet avec noms de composants comme clés
definePrefab({ Position: { x: 0 }, Health: { hp: 100 } })
```

---

## defineEvents / emit / onEvent

```ts
// ✅ Déclarer le contrat une fois (src/events/enemy.ts)
export const EnemyEvents = defineEvents({
  'enemy:hit': (damage: number) => {},
  'enemy:die': () => {},
})

// ✅ Émettre depuis un acteur ou système
emit('enemy:hit', damage)

// ✅ Écouter depuis un acteur (auto-removed à la destruction)
onEvent('enemy:hit', (damage) => { ... })

// ✅ Écouter depuis un système
const engine = useEngine()
engine.hooks.hook('enemy:hit', (damage) => { ... })
```

Convention : nommer les événements `'namespace:action'` pour éviter les collisions avec les hooks internes du moteur (`'engine:tick'`, `'entity:spawn'`, etc.).

---

## definePlugin / @gwenjs/kit

```ts
// ✅ CORRECT — setup(engine), pas install, pas de clé 'systems'
export const InputPlugin = definePlugin<{ deadzone?: number }>((opts = {}) => ({
  name: 'input',
  setup(engine) {
    engine.provide('input', { ... })
    engine.hooks.hook('engine:init', () => { ... })
    engine.hooks.hook('engine:stop', () => { ... })
  },
}))

// ❌ FAUX
definePlugin(() => ({
  name: 'input',
  systems: [InputSystem],   // 'systems' n'existe pas sur PluginDef
  install: (engine) => { }, // 'install' n'existe pas, c'est 'setup'
}))
```

---

## defineGwenModule / @gwenjs/kit/module

```ts
// ✅ CORRECT — un seul argument objet avec meta + setup
export default defineGwenModule<MyOptions>({
  meta: { name: '@my-scope/module', configKey: 'module' },
  defaults: { debug: false },
  setup(options, gwen) {
    gwen.addPlugin(MyPlugin(options))
    gwen.addAutoImports([{ name: 'useMyService', from: '@my-scope/module' }])
  },
})

// ❌ FAUX — deux arguments séparés
defineGwenModule('@my-scope/module', { exports: { ... } })
```

**GwenKit methods :** `addPlugin`, `addAutoImports`, `addVitePlugin`, `extendViteConfig`, `addTypeTemplate`, `addModuleAugment`, `hook`

**GwenBuildHooks events :** `'build:before'`, `'build:done'`, `'module:before'`, `'module:done'`, `'vite:extendConfig'`

---

## AutoImport (type)

```ts
// ✅ CORRECT
{ name: 'useInput', from: '@my-scope/input', as?: 'useInputAlias' }

// ❌ FAUX — 'imports' n'existe pas, c'est 'as'
{ name: 'useInput', from: '@my-scope/input', imports: [...] }
```

---

## Imports par subpath

| Ce que tu importes | Depuis |
|---|---|
| `createEngine`, `useEngine`, `defineComponent`, `Types`, `createLogger`, `initWasm` | `@gwenjs/core` |
| `defineSystem`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `useQuery`, `useService`, `useWasmModule` | `@gwenjs/core/system` |
| `defineActor`, `onStart`, `onDestroy`, `onEvent`, `definePrefab`, `defineEvents`, `emit`, `useActor`, `useComponent`, `usePrefab`, `useTransform`, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab` | `@gwenjs/core/actor` |
| `defineScene`, `defineSceneRouter`, `useSceneRouter`, `useSystem`, `onEnter`, `onExit` | `@gwenjs/core/scene` |
| `definePlugin` | `@gwenjs/kit/plugin` |
| `defineGwenModule` | `@gwenjs/kit/module` |
| `defineConfig` | `@gwenjs/app` |
| `usePhysics2D` | `@gwenjs/physics2d` |

---

## Lifecycle hooks : où ils sont valides

| Hook | Contexte valide |
|---|---|
| `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender` | `defineSystem` ET `defineActor` |
| `onStart`, `onDestroy`, `onEvent` | `defineActor` uniquement |

```ts
// ❌ FAUX — onStart n'existe pas dans defineSystem
defineSystem(function MySystem() {
  onStart(() => { ... }) // erreur runtime
})
```

---

## useTween

```ts
// ✅ API correcte
const opacity = useTween<number>({ duration: 0.5, easing: 'easeInOut', loop: false, yoyo: false })

opacity.play({ from: 0, to: 1 })
opacity.pause()
opacity.reset()
opacity.to({ value: 0, duration: 0.3 })
opacity.onComplete(() => { ... })
opacity.onLoop(() => { ... })
opacity.value    // lecture seule
opacity.playing  // lecture seule
```

---

## createLogger

```ts
// ✅ CORRECT
const log = createLogger('game:my-system')

// ❌ FAUX — le deuxième argument n'est pas un boolean
const log = createLogger('game:my-system', engine.debug)
```

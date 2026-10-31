# @gwenjs/kit

The official plugin and module authoring kit for GWEN. Provides `definePlugin`, `defineGwenModule`, and the plugin lifecycle types used by every first-party and third-party GWEN extension.

## Installation

```bash
npm install @gwenjs/kit
```

## definePlugin

`definePlugin` creates a self-contained, reusable game system. A plugin has a `name`, a `setup(engine)`, and an optional `teardown`. Register frame work with `engine.hooks.hook` inside `setup`.

```typescript
import { definePlugin } from "@gwenjs/kit/plugin";

export const MyPlugin = definePlugin((config: { debug?: boolean } = {}) => {
  let score = 0;

  return {
    name: "my-plugin",

    setup(engine) {
      engine.provide("my-plugin", {
        add(amount: number) {
          score += amount;
        },
      });
      engine.hooks.hook("engine:update", () => {
        if (config.debug) score += 1;
      });
    },

    teardown() {
      score = 0;
    },
  };
});
```

## defineGwenModule

`defineGwenModule` registers a collection of plugins as a single installable unit in a GWEN app config.

```typescript
import { defineGwenModule } from "@gwenjs/kit/module";
import { MyPlugin } from "./my-plugin";

export const MyModule = defineGwenModule({
  id: "my-module",
  plugins: [MyPlugin({ debug: true })],
});
```

## Plugin lifecycle

| Piece                                    | When                                   | Typical use                          |
| ---------------------------------------- | -------------------------------------- | ------------------------------------ |
| `setup(engine)`                          | Once, when the plugin is registered    | Register services and hook listeners |
| `engine.hooks.hook("engine:update", fn)` | Every frame, registered inside `setup` | Sync physics, update state machines  |
| `teardown()`                             | `engine.unuse` or `engine.stop`        | Free resources, cancel subscriptions |

## Accessing plugin services from actors

Register a service in `setup` with `engine.provide`. Actors read it with `useService`. A typed key augments `GwenProvides` (`packages/schema/src/plugin.ts`).

```typescript
import { onUpdate, useService } from "@gwenjs/core/system";

const PlayerActor = defineActor(PlayerPrefab, () => {
  const score = useService("my-plugin");

  onUpdate(() => {
    score.add(1);
  });
});
```

## See also

- `@gwenjs/core` — Engine, ECS, WASM bridge
- `@gwenjs/schema` — App configuration schema
- `@gwenjs/app` — Application runtime

## Public exports

### `.`

Values: `GWEN_CONTEXT_BOUNDARIES`, `GwenContextError`, `GwenContextErrorCodes`, `KitErrorCodes`, `_engineSlot`, `_setCurrentScope`, `getCurrentScope`, `tryUseEngine`, `useCurrentScope`, `useErrorReporter`, `useLogger`, `usePerfMark`

`tryUseEngine` returns the engine `useEngine()` returns, or `undefined` where `useEngine()` would throw `CORE:OUTSIDE_ENGINE_CONTEXT`, and never throws.

Types: `AutoImport`, `DeepPartial`, `EngineSlot`, `GwenContextBoundary`, `GwenContextErrorCode`, `MergePluginsPrefabExtensions`, `MergePluginsSceneExtensions`, `MergePluginsUIExtensions`, `VitePlugin`, `ViteUserConfig`

### `./plugin`

Values: `createEntityId`, `definePlugin`, `optionalService`, `satisfiesPluginContract`, `unpackEntityId`, `watchService`

Types: `ComponentType`, `EntityId`, `GwenPlugin`, `GwenPluginFactory`, `GwenProvides`, `GwenRuntimeHooks`, `PluginErrorContext`

### `./module`

Values: `defineGwenModule`

Types: `GwenBaseConfig`, `GwenBuildHooks`, `GwenKit`, `GwenModule`, `GwenModuleDefinition`, `PluginDeclaration`

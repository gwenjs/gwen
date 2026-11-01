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

`defineGwenModule` declares a build-time module. It needs a non-empty `meta.name` and a `setup` function, and throws `KIT:MODULE_INVALID` otherwise.

```typescript
import { defineGwenModule } from "@gwenjs/kit/module";

export default defineGwenModule({
  meta: { name: "my-module", configKey: "myModule" },
  setup(options, gwen) {
    gwen.addPlugin({ src: "./my-plugin", export: "MyPlugin", options });
  },
});
```

## Plugin lifecycle

| Piece                                    | When                                   | Typical use                          |
| ---------------------------------------- | -------------------------------------- | ------------------------------------ |
| `setup(engine)`                          | Once, when the plugin is registered    | Register services and hook listeners |
| `engine.hooks.hook("engine:update", fn)` | Every frame, registered inside `setup` | Sync physics, update state machines  |
| `teardown()`                             | `engine.unuse` or `engine.stop`        | Free resources, cancel subscriptions |
| `requires`                               | Checked by `engine.use` before `setup` | Plugins and services it needs        |
| `onError(error, context)`                | A throw in `setup`, `teardown`, a hook | Handle it with `context.recover()`   |

## Accessing plugin services from actors

Register a service in `setup` with `engine.provide`. Actors read it with `useService`. A typed key augments `GwenProvides`:

```typescript
declare module "@gwenjs/schema" {
  interface GwenProvides {
    "my-plugin": { add(amount: number): void };
  }
}
```

```typescript
import { onUpdate, useService } from "@gwenjs/core/system";

const PlayerActor = defineActor(PlayerPrefab, () => {
  const score = useService("my-plugin");

  onUpdate(() => {
    score.add(1);
  });
});
```

## Observability

`useLogger`, `useErrorReporter` and `usePerfMark` come from `@gwenjs/kit`. They read the scope of the running plugin `setup`, so call them before its first `await`. Outside a scope they throw `CORE:OUTSIDE_ENGINE_CONTEXT`. `useErrorReporter().report(code, message, cause?)` throws a `GwenError` and logs nothing.

## Errors

A `setup` throw reaches the error bus as `CORE:PLUGIN_SETUP_ERROR`, then `engine.use` rejects with the original error. A `teardown` or hook throw is `CORE:PLUGIN_RUNTIME_ERROR`. A missing `requires` entry rejects with `CORE:PLUGIN_DEPENDENCY_MISSING`.

## See also

- `@gwenjs/core` — Engine, ECS, WASM bridge
- `@gwenjs/schema` — App configuration schema
- `@gwenjs/app` — Application runtime

## Public exports

### `.`

Values: `GWEN_CONTEXT_BOUNDARIES`, `GwenContextError`, `GwenContextErrorCodes`, `GwenModuleDefinitionError`, `KitErrorCodes`, `_engineSlot`, `_setCurrentScope`, `getCurrentScope`, `tryUseEngine`, `useCurrentScope`, `useErrorReporter`, `useLogger`, `usePerfMark`

`tryUseEngine` returns the engine `useEngine()` returns, or `undefined` where `useEngine()` would throw `CORE:OUTSIDE_ENGINE_CONTEXT`, and never throws.

Types: `AutoImport`, `DeepPartial`, `EngineSlot`, `GwenContextBoundary`, `GwenContextErrorCode`, `VitePlugin`, `ViteUserConfig`

### `./plugin`

Values: `createEntityId`, `definePlugin`, `optionalService`, `satisfiesPluginContract`, `unpackEntityId`, `watchService`

Types: `ComponentType`, `EntityId`, `GwenPlugin`, `GwenPluginFactory`, `GwenProvides`, `GwenRuntimeHooks`, `PluginErrorContext`

### `./module`

Values: `GwenModuleDefinitionError`, `defineGwenModule`, `validateGwenModule`

`defineGwenModule` and `validateGwenModule` throw `GwenModuleDefinitionError` (`KIT:MODULE_INVALID`, `fields` lists every invalid path).

Types: `GwenBaseConfig`, `GwenBuildHooks`, `GwenKit`, `GwenModule`, `GwenModuleDefinition`, `PluginDeclaration`

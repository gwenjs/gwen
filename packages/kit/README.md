# @gwenjs/kit

The official plugin and module authoring kit for GWEN. Provides `definePlugin`, `defineGwenModule`, and the plugin lifecycle types used by every first-party and third-party GWEN extension.

## Installation

```bash
npm install @gwenjs/kit
```

## definePlugin

`definePlugin` creates a self-contained, reusable game system. Plugins declare lifecycle hooks (`onSetup`, `onUpdate`, `onDestroy`) and expose a typed service API accessible to actors and other plugins.

```typescript
import { definePlugin } from '@gwenjs/kit';

export const MyPlugin = definePlugin((config: MyConfig = {}) => {
  let score = 0;

  return {
    id: 'my-plugin',

    onSetup(engine) {
      // Called once when the plugin is registered
    },

    onUpdate(engine, delta) {
      // Called every frame — delta is in seconds
    },

    onDestroy() {
      score = 0;
    },

    // Public API exposed to actors via useMyPlugin()
    api: {
      getScore: () => score,
      addScore: (n: number) => { score += n; },
    },
  };
});
```

## defineGwenModule

`defineGwenModule` registers a collection of plugins as a single installable unit in a GWEN app config.

```typescript
import { defineGwenModule } from '@gwenjs/kit';
import { MyPlugin } from './my-plugin';

export const MyModule = defineGwenModule({
  id: 'my-module',
  plugins: [MyPlugin({ debug: true })],
});
```

## Plugin lifecycle

| Hook | When | Typical use |
|------|------|-------------|
| `onSetup(engine)` | Once, after WASM init | Register components, allocate resources |
| `onUpdate(engine, delta)` | Every frame | Sync physics, update state machines |
| `onDestroy()` | Scene teardown | Free resources, cancel subscriptions |

## Accessing plugin services from actors

Plugins that expose an `api` object can be accessed in actors via `usePlugin`:

```typescript
import { usePlugin } from '@gwenjs/core';
import type { MyPluginAPI } from './my-plugin';

const PlayerActor = defineActor(PlayerPrefab, () => {
  const my = usePlugin<MyPluginAPI>('my-plugin');

  onUpdate(() => {
    my.addScore(1);
  });
});
```

## See also

- `@gwenjs/core` — Engine, ECS, WASM bridge
- `@gwenjs/schema` — App configuration schema
- `@gwenjs/app` — Application runtime

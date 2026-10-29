---
title: "@gwenjs/schema"
description: "API reference for @gwenjs/schema."
---

# @gwenjs/schema

`pnpm add @gwenjs/schema`

Shared type definitions for GWEN. Primarily used internally and by plugin authors. Provides unified types for components, systems, and hooks.

## Type Definitions

### GwenHookHandler

**Signature:**
```ts
type GwenHookHandler = (...args: readonly unknown[]) => unknown
```

**Description.** Generic hook handler. The arguments are a `readonly unknown[]`. The return type is `unknown`.

### DeepPartial\<T\>

**Signature:**
```ts
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T
```

**Description.** When `T` is an object, every property is optional and itself a `DeepPartial`. Otherwise the type is `T`.

User configuration is `GwenUserConfig` in `@gwenjs/app` and `resolveGwenConfig` in `@gwenjs/app/resolve`. See `### ResolvedGwenConfig` in `docs/api/app.md`. The field table is `## Config Reference` in `docs/essentials/engine.md`.

## Errors

`GwenError` fields: `code`, `composable`, `hint`, `docsUrl`.

Every call renders `[where] what`, an optional `Fix:` line, and a `See` line. Two arguments use `GWEN` as where. `docsUrl` is always set from the code and the constructing class's `docsBase`.

Values: `GWEN_DOCS_BASE`, `errorDocsAnchor`, `errorDocsUrl`.

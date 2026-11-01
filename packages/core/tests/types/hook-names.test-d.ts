import { expectTypeOf } from "vitest";
import type {
  GwenRuntimeHookName,
  GwenRuntimeHooks,
  HookBusBase,
  IGwenScope,
} from "@gwenjs/schema";
import { defineHooks } from "../../src/hooks/define-hooks";
import { emit } from "../../src/hooks/emit";
import { useHook } from "../../src/hooks/use-hook";
import "@gwenjs/physics3d";
import "@gwenjs/camera-core";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "enemy:died": (id: bigint) => void;
    legacyname: () => void;
  }
}

declare const hooks: HookBusBase;
declare const scope: IGwenScope;
declare const serviceEvent: Parameters<GwenRuntimeHooks["service:provided"]>[0];

defineHooks({
  "enemy:died": (_id: bigint): void => undefined,
});

defineHooks({
  // @ts-expect-error hook name must be namespace:action
  enemyDied: (): void => undefined,
});

defineHooks({
  // @ts-expect-error hook name must be namespace:action
  ":x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error hook name must be namespace:action
  "x:": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "engine:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "entity:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "scene:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "plugin:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "actor:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "prefab:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error reserved namespace
  "service:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error framework namespace
  "camera:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error framework namespace
  "viewport:x": (): void => undefined,
});

defineHooks({
  // @ts-expect-error framework namespace
  "physics:x": (): void => undefined,
});

// @ts-expect-error reserved namespace
emit("engine:tick", 0);

// @ts-expect-error undeclared hook
emit("nope:x");

// @ts-expect-error reserved namespace
emit("service:provided", serviceEvent);

useHook("engine:tick", (dt) => {
  const n: number = dt;
  expectTypeOf(n).toEqualTypeOf<number>();
});

useHook("service:provided", (event) => {
  const key: string = event.key;
  expectTypeOf(key).toEqualTypeOf<string>();
});

useHook("camera:activate", (payload) => {
  const id: string = payload.viewportId;
  expectTypeOf(id).toEqualTypeOf<string>();
});

// @ts-expect-error undeclared hook
useHook("nope:x", () => undefined);

// @ts-expect-error malformed hook name
useHook("legacyname", () => undefined);

// @ts-expect-error physics3d:step is not a hook
useHook("physics3d:step", (_stepDt: number) => undefined);

// @ts-expect-error malformed hook name
hooks.hook("nope:x", () => undefined);

// @ts-expect-error malformed hook name
hooks.hook("legacyname", () => undefined);

// @ts-expect-error malformed hook name
scope.hook("nope:x", () => undefined);

// @ts-expect-error malformed hook name
scope.hook("legacyname", () => undefined);

expectTypeOf<
  Exclude<keyof GwenRuntimeHooks, GwenRuntimeHookName | "legacyname">
>().toEqualTypeOf<never>();

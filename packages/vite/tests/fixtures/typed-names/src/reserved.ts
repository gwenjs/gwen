import type { GwenRuntimeHookName } from "@gwenjs/schema";
import { expectTypeOf } from "vitest";

expectTypeOf<Extract<GwenRuntimeHookName, `engine:${string}` | `entity:${string}`>>().toEqualTypeOf<
  | "engine:after-update"
  | "engine:afterTick"
  | "engine:before-update"
  | "engine:error"
  | "engine:init"
  | "engine:memory-grow"
  | "engine:render"
  | "engine:start"
  | "engine:state-change"
  | "engine:stop"
  | "engine:tick"
  | "engine:update"
  | "entity:destroy"
  | "entity:spawn"
>();

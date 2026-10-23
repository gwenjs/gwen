import { describe, expectTypeOf, it } from "vitest";
import type {
  EngineErrorPayload,
  EngineStateChangePayload,
  EntityId,
  GwenRuntimeHooks,
  PluginErrorContext,
  PluginErrorEvent,
} from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenPrefabExtensions {
    fx?: { n: number };
  }
}

describe("hook map", () => {
  it("GwenRuntimeHooks lists the core engine hooks with their payloads", () => {
    expectTypeOf<GwenRuntimeHooks["engine:state-change"]>().parameters.toEqualTypeOf<
      [EngineStateChangePayload]
    >();
    expectTypeOf<GwenRuntimeHooks["entity:spawn"]>().parameters.toEqualTypeOf<[EntityId]>();
    expectTypeOf<GwenRuntimeHooks["engine:render"]>().parameters.toEqualTypeOf<[number]>();
    expectTypeOf<GwenRuntimeHooks["engine:error"]>().parameters.toEqualTypeOf<
      [EngineErrorPayload]
    >();
  });

  it("plugin:error receives a PluginErrorEvent", () => {
    expectTypeOf<GwenRuntimeHooks["plugin:error"]>().parameters.toEqualTypeOf<[PluginErrorEvent]>();
    expectTypeOf<PluginErrorEvent["phase"]>().toEqualTypeOf<PluginErrorContext["phase"]>();
  });

  it("an augmentation of GwenPrefabExtensions through schema reaches prefab:instantiate", () => {
    expectTypeOf<Parameters<GwenRuntimeHooks["prefab:instantiate"]>[1]["fx"]>().toEqualTypeOf<
      { n: number } | undefined
    >();
  });
});

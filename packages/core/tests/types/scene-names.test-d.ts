import { expectTypeOf } from "vitest";
import type { GwenSceneName } from "@gwenjs/schema";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import type { SceneDefinition } from "../../src/scene/runtime/define-scene.js";

// GwenSceneName is string with an empty registry
expectTypeOf<GwenSceneName>().toEqualTypeOf<string>();

// defineScene("anything") compiles and sceneName keeps the literal "game"
defineScene("anything", () => {});
expectTypeOf(defineScene("game", () => {}).sceneName).toEqualTypeOf<"game">();

// SceneDefinition<"game">["name"] is "game"
expectTypeOf<SceneDefinition<"game">["name"]>().toEqualTypeOf<"game">();

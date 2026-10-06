import { expectTypeOf } from "vitest";

import type { GwenEngine } from "../../src/engine/gwen-engine";
import { useService } from "../../src/system/runtime/define-system";
import { SCENE_REGISTRAR_KEY, type SceneRegistrar } from "../../src/scene/runtime/scene-registrar";
import { SceneHookRegistry } from "../../src/scene/engine-plugin";

declare const engine: GwenEngine;

expectTypeOf(engine.inject("scene:registrar")).toEqualTypeOf<SceneRegistrar>();
expectTypeOf(engine.inject(SCENE_REGISTRAR_KEY)).toEqualTypeOf<SceneRegistrar>();
expectTypeOf(engine.inject("scene:hook-registry")).toEqualTypeOf<SceneHookRegistry>();
expectTypeOf(useService("scene:registrar")).toEqualTypeOf<SceneRegistrar>();
expectTypeOf(useService("scene:hook-registry")).toEqualTypeOf<SceneHookRegistry>();

// @ts-expect-error unknown service key
engine.inject("not-a-service");
// @ts-expect-error unknown service key
useService("not-a-service");

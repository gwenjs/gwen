import { expectTypeOf } from "vitest";

import type { GwenEngineBase, GwenPluginRequires, GwenProvides, IGwenLogger } from "@gwenjs/schema";
import { useService } from "../../src/system/runtime/define-system";

declare const base: GwenEngineBase;
declare const logger: IGwenLogger;

// P1: inject accepts only declared service keys.
expectTypeOf<Parameters<GwenEngineBase["inject"]>[0]>().toEqualTypeOf<
  keyof GwenProvides & string
>();

// P2: tryInject accepts only declared service keys.
expectTypeOf<Parameters<GwenEngineBase["tryInject"]>[0]>().toEqualTypeOf<
  keyof GwenProvides & string
>();

// P3: provide accepts only declared service keys.
expectTypeOf<Parameters<GwenEngineBase["provide"]>[0]>().toEqualTypeOf<
  keyof GwenProvides & string
>();

// P4: provide rejects a value that is not the type stored for that key.
// expect-type 1.3.0 types `.not.toBeCallableWith` as `never` (index.d.ts).
// A call-signature check is the same rejection, and it stays red while
// `provide` accepts `unknown`.
type ProvideAccepts<K extends string, V> = GwenEngineBase["provide"] extends (
  key: K,
  value: V,
) => void
  ? true
  : false;

expectTypeOf<ProvideAccepts<"logger", number>>().toEqualTypeOf<false>();
expectTypeOf<ProvideAccepts<"logger", IGwenLogger>>().toEqualTypeOf<true>();
expectTypeOf(base.provide).toBeCallableWith("logger", logger);

// P5: inject and tryInject return the type stored for the key.
expectTypeOf(base.inject("logger")).toEqualTypeOf<IGwenLogger>();
expectTypeOf(base.tryInject("logger")).toEqualTypeOf<IGwenLogger | undefined>();

// P6: requires.services accepts only declared service keys.
expectTypeOf<NonNullable<GwenPluginRequires["services"]>[number]>().toEqualTypeOf<
  keyof GwenProvides & string
>();
expectTypeOf<{ readonly services: readonly ["nope"] }>().not.toExtend<GwenPluginRequires>();
expectTypeOf<{ readonly services: readonly ["logger"] }>().toExtend<GwenPluginRequires>();

// P7: requires.optional accepts only declared service keys.
expectTypeOf<NonNullable<GwenPluginRequires["optional"]>[number]>().toEqualTypeOf<
  keyof GwenProvides & string
>();
expectTypeOf<{ readonly optional: readonly ["nope"] }>().not.toExtend<GwenPluginRequires>();
expectTypeOf<{ readonly optional: readonly ["logger"] }>().toExtend<GwenPluginRequires>();

// P8: useService is already keyed by the service map.
expectTypeOf<Parameters<typeof useService>[0]>().toEqualTypeOf<keyof GwenProvides & string>();
expectTypeOf(useService("logger")).toEqualTypeOf<IGwenLogger>();

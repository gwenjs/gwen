import { expectTypeOf } from "vitest";
import type { GwenConfigInput } from "../../src/index.ts";

type PluginManifest = NonNullable<GwenConfigInput["plugins"]>[number];

type Accepts<Value, Target> = [Value] extends [Target] ? true : false;

type SharedMemoryManifest = Accepts<
  { readonly name: "demo"; readonly wasm: { readonly sharedMemory: true } },
  PluginManifest
>;

expectTypeOf<SharedMemoryManifest>().toEqualTypeOf<false>();

const otherWasmKey: PluginManifest = {
  name: "demo",
  wasm: { moduleUrl: "demo.wasm" },
};

expectTypeOf(otherWasmKey.name).toEqualTypeOf<string>();

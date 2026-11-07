import { expectTypeOf } from "vitest";
import { defineConfig } from "../src/types.js";

declare module "@gwenjs/schema" {
  interface GwenModuleOptions {
    physics2d?: { gravity?: { y?: number } };
  }
}

defineConfig({ physics2d: { gravity: { y: 1 } } });

expectTypeOf<Parameters<typeof defineConfig>[0]["physics2d"]>().toEqualTypeOf<
  { gravity?: { y?: number } } | undefined
>();

const bad: { physics2d: { gravity: string } } = { physics2d: { gravity: "x" } };
expectTypeOf(bad).not.toExtend<Parameters<typeof defineConfig>[0]>();

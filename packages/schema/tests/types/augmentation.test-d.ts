import { describe, expectTypeOf, it } from "vitest";
import type { HookBusBase, IGwenLogger } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "aug:key": { n: number };
  }
  interface GwenModuleOptions {
    fixture?: { level: number };
  }
  interface GwenRuntimeHooks {
    "aug:hook": (score: number) => void;
  }
}

// A second augmentation of the same key with the same type merges.
declare module "@gwenjs/schema" {
  interface GwenProvides {
    "aug:key": { n: number };
  }
}

type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];

describe("augmentation", () => {
  it("GwenProvides augmented through schema is typed", () => {
    type Provides = import("@gwenjs/schema").GwenProvides;
    expectTypeOf<Provides["aug:key"]>().toEqualTypeOf<{ n: number }>();
    type Logger = Provides extends { logger: infer L } ? L : never;
    expectTypeOf<Logger>().toEqualTypeOf<IGwenLogger>();
  });

  it("GwenModuleOptions augmented through schema is typed", () => {
    type Options = import("@gwenjs/schema").GwenModuleOptions;
    expectTypeOf<Options["fixture"]>().toEqualTypeOf<{ level: number } | undefined>();
    type Declared = import("../../src/module.ts").GwenModuleOptions;
    expectTypeOf<RequiredKeys<Declared>>().toEqualTypeOf<never>();
  });

  it("GwenRuntimeHooks augmented through schema is typed on HookBusBase.hook", () => {
    const read = (bus: HookBusBase): void => {
      bus.hook("aug:hook", (score) => {
        expectTypeOf(score).toEqualTypeOf<number>();
      });
    };
    expectTypeOf(read).toBeFunction();
  });
});

import { expectTypeOf } from "vitest";

import { defineHooks, type InferHooks } from "../../src/hooks/define-hooks";
import { emit } from "../../src/hooks/emit";
import { useHook } from "../../src/hooks/use-hook";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "test:hit": (amount: number) => void;
  }
}

const gameHooks = defineHooks({
  "enemy:died": (_id: bigint): void => undefined,
});

expectTypeOf<InferHooks<typeof gameHooks>>().toEqualTypeOf<{
  "enemy:died": (id: bigint) => void;
}>();

emit("test:hit", 1);
emit("engine:tick", 0.016);

emit(
  "test:hit",
  // @ts-expect-error amount is a number
  "x",
);

// @ts-expect-error unknown hook
emit("test:missing");

useHook("engine:tick", (dt) => {
  expectTypeOf(dt).toEqualTypeOf<number>();
});

// @ts-expect-error unknown hook
useHook("test:missing", () => undefined);

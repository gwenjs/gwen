import { describe, expectTypeOf, it } from "vitest";
import { useErrorReporter } from "../src/observability.js";

describe("useErrorReporter", () => {
  it("report takes a colon code and returns never", () => {
    expectTypeOf<
      Parameters<ReturnType<typeof useErrorReporter>["report"]>[0]
    >().toEqualTypeOf<`${string}:${string}`>();
    expectTypeOf<
      ReturnType<ReturnType<typeof useErrorReporter>["report"]>
    >().toEqualTypeOf<never>();
  });
});

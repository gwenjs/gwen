import { describe, expect, expectTypeOf, it } from "vitest";
import type { GwenEngine } from "@gwenjs/core";
import * as plugin from "@gwenjs/kit/plugin";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p72:marker": { readonly n: number };
  }
}

declare const engine: GwenEngine;

function checkMarkerTypes(): void {
  plugin.watchService("p72:marker", (value) => {
    expectTypeOf(value).toEqualTypeOf<{ readonly n: number } | undefined>();
  });
  const markerSlot = plugin.optionalService(engine, "p72:marker");
  expectTypeOf(markerSlot.current).toEqualTypeOf<{ readonly n: number } | undefined>();
}
void checkMarkerTypes;

describe("service change types", () => {
  it("narrows p72:marker on watchService and optionalService", () => {
    expect(typeof plugin.watchService).toBe("function");
    expect(typeof plugin.optionalService).toBe("function");
  });
});

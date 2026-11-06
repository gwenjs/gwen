import { describe, expectTypeOf, it } from "vitest";
import type { GwenExtensionApi, GwenExtensionService } from "@gwenjs/schema";

describe("GwenExtensionService", () => {
  it("GwenExtensionService is extensionApi plus a registration count", () => {
    expectTypeOf<GwenExtensionService>().toEqualTypeOf<{
      readonly extensionApi: GwenExtensionApi;
      readonly registrations: number;
    }>();
  });
});

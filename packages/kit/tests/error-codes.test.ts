import { describe, expect, it } from "vitest";
import * as kit from "@gwenjs/kit";

describe("KitErrorCodes", () => {
  it("KitErrorCodes holds the module and source transform codes", () => {
    expect(kit.KitErrorCodes).toEqual({
      MODULE_INVALID: "KIT:MODULE_INVALID",
      SOURCE_TRANSFORM_INVALID: "KIT:SOURCE_TRANSFORM_INVALID",
      SOURCE_TRANSFORM_DUPLICATE: "KIT:SOURCE_TRANSFORM_DUPLICATE",
    });
  });
});

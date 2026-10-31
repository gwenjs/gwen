import { describe, expect, it } from "vitest";
import * as kit from "@gwenjs/kit";

describe("KitErrorCodes", () => {
  it("KitErrorCodes has only MODULE_INVALID", () => {
    expect(Object.keys(kit.KitErrorCodes)).toEqual(["MODULE_INVALID"]);
  });
});

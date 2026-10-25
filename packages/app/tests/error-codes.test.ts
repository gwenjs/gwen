import { describe, expect, it } from "vitest";
import * as app from "../src/error-codes";
import * as kit from "@gwenjs/kit";

describe("AppErrorCodes", () => {
  it("AppErrorCodes.MODULE_INVALID is KitErrorCodes.MODULE_INVALID", () => {
    expect(typeof kit.KitErrorCodes).toBe("object");
    expect(app.AppErrorCodes.MODULE_INVALID).toBe(kit.KitErrorCodes.MODULE_INVALID);
    expect(app.AppErrorCodes.MODULE_INVALID).toBe("KIT:MODULE_INVALID");
  });
});

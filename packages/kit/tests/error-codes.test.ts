import { describe, expect, it } from "vitest";
import * as kit from "@gwenjs/kit";

describe("KitErrorCodes", () => {
  it("KitErrorCodes holds KIT:PLUGIN_SETUP_FAILED and KIT:MODULE_INVALID", () => {
    expect(typeof kit.KitErrorCodes).toBe("object");
    expect(kit.KitErrorCodes.PLUGIN_SETUP_FAILED).toBe("KIT:PLUGIN_SETUP_FAILED");
    expect(kit.KitErrorCodes.MODULE_INVALID).toBe("KIT:MODULE_INVALID");
  });
});

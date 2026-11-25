import { describe, expect, it } from "vitest";
import * as schema from "@gwenjs/schema";
import { CoreErrorCodes } from "../../src/engine/engine-errors";

describe("introspection error code", () => {
  it("CoreErrorCodes.INTROSPECTION_PAGE_INVALID equals the schema constant", () => {
    expect(typeof schema.GWEN_INTROSPECTION_ERROR_CODES).toBe("object");
    expect(CoreErrorCodes.INTROSPECTION_PAGE_INVALID).toBe(
      schema.GWEN_INTROSPECTION_ERROR_CODES.PAGE_INVALID,
    );
    expect(CoreErrorCodes.INTROSPECTION_PAGE_INVALID).toBe("CORE:INTROSPECTION_PAGE_INVALID");
  });
});

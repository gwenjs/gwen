import { describe, expect, it } from "vitest";
import * as schema from "@gwenjs/schema";

describe("renderer contract", () => {
  it("@gwenjs/schema exports RENDERER_CONTRACT_VERSION 2 and RENDER_VIEW_MATRIX_LENGTH 16", () => {
    expect(schema.RENDERER_CONTRACT_VERSION).toBe(2);
    expect(schema.RENDER_VIEW_MATRIX_LENGTH).toBe(16);
  });
});

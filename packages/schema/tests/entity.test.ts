/**
 * Entity id packing lives in `@gwenjs/schema`. Core re-exports the same functions.
 */

import { describe, expect, it } from "vitest";
import * as core from "@gwenjs/core";
import { entityIndex } from "@gwenjs/core/internal";
import * as schema from "@gwenjs/schema";
// entityGeneration has no public path.
import { entityGeneration } from "../../core/src/types/entity.ts";

describe("entity ids", () => {
  it("schema exports createEntityId and it packs the generation in the high 32 bits", () => {
    expect(typeof schema.createEntityId).toBe("function");
    expect(schema.createEntityId(0, 0)).toBe(0n);
    expect(schema.createEntityId(0xffffffff, 0xffffffff)).toBe(0xffffffffffffffffn);
    expect(schema.unpackEntityId(schema.createEntityId(0, 0))).toEqual({
      index: 0,
      generation: 0,
    });
    expect(schema.unpackEntityId(schema.createEntityId(0xffffffff, 0xffffffff))).toEqual({
      index: 0xffffffff,
      generation: 0xffffffff,
    });
  });

  it("entityIndex and entityGeneration read both sides of the 2^53 boundary", () => {
    const below = schema.createEntityId(0xffffffff, 2 ** 21 - 1);
    const above = schema.createEntityId(0, 2 ** 21);
    expect(schema.entityIndex?.(below)).toBe(0xffffffff);
    expect(schema.entityGeneration?.(below)).toBe(2 ** 21 - 1);
    expect(schema.entityIndex?.(above)).toBe(0);
    expect(schema.entityGeneration?.(above)).toBe(2 ** 21);
  });

  it("entityIndex rejects a number with CORE:INVALID_ENTITY_ID", () => {
    let caught: unknown;
    try {
      schema.entityIndex(1 as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(schema.GwenError);
    if (!(caught instanceof schema.GwenError)) return;
    expect(caught.code).toBe("CORE:INVALID_ENTITY_ID");
    expect(caught.code).toBe(core.CoreErrorCodes.INVALID_ENTITY_ID);
    expect(caught.message).toBe("EntityId must be a bigint");
  });

  it("entityGeneration rejects a number with CORE:INVALID_ENTITY_ID", () => {
    let caught: unknown;
    try {
      schema.entityGeneration(1 as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(schema.GwenError);
    if (!(caught instanceof schema.GwenError)) return;
    expect(caught.code).toBe("CORE:INVALID_ENTITY_ID");
    expect(caught.code).toBe(core.CoreErrorCodes.INVALID_ENTITY_ID);
    expect(caught.message).toBe("EntityId must be a bigint");
  });

  it("core re-exports the same entity functions", () => {
    expect(core.createEntityId).toBe(schema.createEntityId);
    expect(core.unpackEntityId).toBe(schema.unpackEntityId);
    expect(entityIndex).toBe(schema.entityIndex);
    expect(entityGeneration).toBe(schema.entityGeneration);
  });
});

import { describe, expect, it } from "vitest";

import { measureAllocations } from "../../bench/alloc/measure";

describe("measureAllocations", () => {
  it("rejects ops that are not a positive integer", async () => {
    await expect(measureAllocations(() => undefined, { warmup: 0, ops: 0 })).rejects.toThrow(
      "[ALLOC GATE] measureAllocations: ops must be > 0",
    );
  });

  it("reports one run as bytes per op", async () => {
    let sink = 0;
    const report = await measureAllocations(
      () => {
        const row = Array.from({ length: 64 }, (_, index) => index);
        sink = row[0] ?? 0;
      },
      { warmup: 1, ops: 64 },
    );
    expect(sink).toBe(0);
    expect(report.bytesPerOp).toBe(report.allocatedBytes / 64);
    expect(Number.isInteger(report.gcCount)).toBe(true);
    expect(report.gcCount).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.retainedBytes)).toBe(true);
  });
});

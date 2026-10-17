import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { measureAllocations } from "./allocation.js";

const OPS = 8_000;
const SPIKE_BYTES = 20_000;

/** Objects the tests keep alive so V8 cannot remove the allocation. */
const sink: unknown[] = Array.from({ length: 1_024 });

function spike(): void {
  sink[0] = Array.from({ length: SPIKE_BYTES / 8 }, () => 0);
}

describe("measureAllocations", () => {
  it("reports at least the object size for one object per operation", async () => {
    const report = await measureAllocations(
      () => {
        for (let index = 0; index < OPS; index += 1) sink[index & 1_023] = { a: index, b: 1, c: 2 };
      },
      { warmup: 4, ops: OPS },
    );
    expect(report.windows).toHaveLength(7);
    expect(report.bytesPerOp).toBeGreaterThanOrEqual(24);
  });

  it("ignores a one-off allocation that lands in a single window", async () => {
    let call = 0;
    const report = await measureAllocations(
      () => {
        call += 1;
        if (call === 5) spike();
      },
      { warmup: 4, ops: OPS },
    );
    expect(report.windows).toHaveLength(7);
    expect(Math.max(...report.windows)).toBeGreaterThanOrEqual(SPIKE_BYTES);
    expect(report.bytesPerOp).toBeLessThan(1);
  });

  it("reports an allocation that lands in every window", async () => {
    const report = await measureAllocations(spike, { warmup: 4, ops: OPS });
    expect(report.windows).toHaveLength(7);
    expect(report.bytesPerOp).toBeGreaterThanOrEqual(1);
  });

  it("subtracts the cost of its own counter reads", async () => {
    const report = await measureAllocations(() => {}, { warmup: 4, ops: OPS });
    expect(report.floorBytes).toBeGreaterThan(0);
    expect(report.bytesPerOp).toBeLessThan(0.25);
  });

  it("counts the elements of a large array kept alive per operation", async () => {
    const ops = 20;
    const report = await measureAllocations(
      () => {
        for (let index = 0; index < ops; index += 1)
          sink[index & 7] = Array.from({ length: 20_000 }, () => 0.5);
      },
      { warmup: 4, ops },
    );
    expect(report.windows).toHaveLength(7);
    // 20 000 doubles are 160 000 bytes in the large-object space. The array header alone is 32.
    expect(report.bytesPerOp).toBeGreaterThanOrEqual(100_000);
  });

  it("throws unstable when a GC runs in every window", async () => {
    v8.setFlagsFromString("--expose-gc");
    const collect: unknown = vm.runInNewContext("gc");
    if (typeof collect !== "function") throw new Error("gc is not available");
    await expect(
      measureAllocations(
        () => {
          Reflect.apply(collect, undefined, []);
        },
        { warmup: 4, ops: OPS },
      ),
    ).rejects.toThrow(/unstable \(GC in every window\)/);
  });

  it("rejects fewer than three windows", async () => {
    await expect(measureAllocations(() => {}, { warmup: 0, ops: OPS, repeats: 2 })).rejects.toThrow(
      /repeats must be an integer >= 3/,
    );
  });
});

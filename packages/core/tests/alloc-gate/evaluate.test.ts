import { describe, expect, it } from "vitest";

import {
  formatAllocFailure,
  evaluateAllocGate,
  type AllocMeasurement,
  type AllocPathName,
  type AllocThresholds,
} from "../../bench/alloc/evaluate-alloc-gate";

const PATHS: AllocPathName[] = [
  "frame.empty",
  "update.system",
  "update.actor",
  "query.raw",
  "query.entities",
  "bulk.query",
  "bulk.components",
  "pool.cycle",
  "tween.tick",
  "entity.index",
];

function thresholds(overrides?: {
  nodeMajor?: number;
  paths?: AllocThresholds["paths"];
  frames?: number;
}): AllocThresholds {
  const paths = {} as AllocThresholds["paths"];
  for (const path of PATHS) {
    paths[path] = { bytesPerFrame: 100, bytesPerEntityFrame: 1 };
  }
  return {
    version: 1,
    nodeMajor: overrides?.nodeMajor ?? 22,
    entities: [1000, 2000],
    run: { warmupFrames: 8, frames: overrides?.frames ?? 20, repeats: 5 },
    margins: { bytesPerFrame: 1024, bytesPerEntityFrame: 8 },
    paths: overrides?.paths ?? paths,
  };
}

function measured(partial?: Partial<Record<AllocPathName, [number, number]>>): AllocMeasurement[] {
  return PATHS.map((path) => {
    const pair = partial?.[path] ?? [100, 1];
    return { path, bytesPerFrame: pair[0], bytesPerEntityFrame: pair[1] };
  });
}

describe("evaluateAllocGate", () => {
  it("passes when every path stays inside the margin", () => {
    const report = evaluateAllocGate(measured(), thresholds(), 22);
    expect(report.verdict).toBe("pass");
    expect(report.failures).toEqual([]);
    expect(report.lowerable).toEqual([]);
  });

  it("fails when bytesPerFrame rises past the margin", () => {
    const report = evaluateAllocGate(measured({ "update.system": [1125, 1] }), thresholds(), 22);
    expect(report.verdict).toBe("fail");
    expect(report.failures).toEqual([
      {
        path: "update.system",
        metric: "bytesPerFrame",
        recorded: 100,
        measured: 1125,
        limit: 1124,
      },
    ]);
  });

  it("fails when bytesPerEntityFrame rises past the margin", () => {
    const report = evaluateAllocGate(measured({ "query.entities": [100, 9.1] }), thresholds(), 22);
    expect(report.verdict).toBe("fail");
    expect(report.failures).toEqual([
      {
        path: "query.entities",
        metric: "bytesPerEntityFrame",
        recorded: 1,
        measured: 9.1,
        limit: 9,
      },
    ]);
  });

  it("fails when a path has no recorded threshold", () => {
    const file = thresholds();
    delete file.paths["tween.tick"];
    const report = evaluateAllocGate(measured(), file, 22);
    expect(report.verdict).toBe("fail");
    expect(report.messages).toContain("[ALLOC GATE] tween.tick: no recorded threshold");
  });

  it("fails when the thresholds file has an unknown path", () => {
    const file = thresholds();
    (file.paths as Record<string, unknown>)["not.a.path"] = {
      bytesPerFrame: 1,
      bytesPerEntityFrame: 0,
    };
    const report = evaluateAllocGate(measured(), file, 22);
    expect(report.verdict).toBe("fail");
    expect(report.messages).toContain("[ALLOC GATE] not.a.path: no recorded threshold");
  });

  it("fails when the running Node major does not match the recording", () => {
    const report = evaluateAllocGate(measured(), thresholds(), 24);
    expect(report.verdict).toBe("fail");
    expect(report.failures).toEqual([]);
    expect(report.messages).toEqual([
      "[ALLOC GATE] Node major 24 != recorded 22. Re-record thresholds on Node 24.",
    ]);
  });

  it("does not fail when a measurement can be lowered", () => {
    const file = thresholds();
    file.paths["frame.empty"] = { bytesPerFrame: 2000, bytesPerEntityFrame: 1 };
    const report = evaluateAllocGate(measured({ "frame.empty": [0, 1] }), file, 22);
    expect(report.verdict).toBe("pass");
    expect(report.failures).toEqual([]);
    expect(report.lowerable).toEqual([
      {
        path: "frame.empty",
        metric: "bytesPerFrame",
        recorded: 2000,
        measured: 0,
      },
    ]);
    expect(report.messages).toContain(
      "[ALLOC GATE] frame.empty bytesPerFrame: can be lowered (recorded 2000 → measured 0)",
    );
  });

  it("prints the exact failure line", () => {
    const file = thresholds({ frames: 16 });
    file.paths["update.actor"] = { bytesPerFrame: 100, bytesPerEntityFrame: 1, frames: 4 };
    const report = evaluateAllocGate(measured({ "update.actor": [2000, 1] }), file, 22);
    const failure = report.failures[0]!;
    const line = formatAllocFailure(failure, file, 22);
    expect(line).toBe(
      "[ALLOC GATE] update.actor bytesPerFrame: recorded 100 → measured 2000 (limit 1124, E=1000→2000, 4 frames, Node 22)",
    );
    expect(report.messages).toContain(line);
  });
});

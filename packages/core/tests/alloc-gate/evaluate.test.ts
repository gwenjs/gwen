import { describe, expect, it } from "vitest";

import {
  formatAllocFailure,
  evaluateAllocGate,
  parseAllocThresholds,
  type AllocGateReport,
  type AllocMeasurement,
  type AllocPathName,
  type AllocPathThreshold,
  type AllocThresholds,
} from "../../bench/alloc/evaluate-alloc-gate";
import recordedFile from "../../bench/alloc-thresholds.json" with { type: "json" };

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
    const paths: Record<string, AllocPathThreshold> = {};
    for (const path of PATHS) {
      if (path === "tween.tick") continue;
      paths[path] = file.paths[path];
    }
    const parsed = parseAllocThresholds({ ...file, paths });
    const report = evaluateAllocGate(measured(), parsed, 22);
    expect(report.verdict).toBe("fail");
    expect(report.messages).toContain("[ALLOC GATE] tween.tick: no recorded threshold");
  });

  it("fails when a thresholded path was not measured", () => {
    const rows = measured().filter((row) => row.path !== "pool.cycle");
    const report = evaluateAllocGate(rows, thresholds(), 22);
    expect(report.verdict).toBe("fail");
    expect(report.messages).toContain("[ALLOC GATE] pool.cycle: not measured");
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

  it("rejects a thresholds file whose version is not 1", () => {
    const file = { ...thresholds(), version: 2 };
    expect(() => parseAllocThresholds(file)).toThrow("[ALLOC GATE] thresholds: version must be 1");
  });

  it("rejects a thresholds file without margins", () => {
    const { margins: _margins, ...file } = thresholds();
    expect(() => parseAllocThresholds(file)).toThrow("[ALLOC GATE] thresholds: margins invalid");
  });

  it("rejects a thresholds file without run", () => {
    const { run: _run, ...file } = thresholds();
    expect(() => parseAllocThresholds(file)).toThrow("[ALLOC GATE] thresholds: run invalid");
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

// Highest bytes per frame measured on Node 22.23.2: five local runs of
// `vitest run --config vitest.alloc.config.ts` and the Allocation gate job of
// CI runs 37938890004, 37937232831 and 37935215155.
const MEASURED_BYTES_PER_FRAME = {
  "frame.empty": 4055.333,
  "query.raw": 4069.333,
  "query.entities": 165828.667,
  "bulk.query": 6013.333,
  "bulk.components": 133220,
} as const;

type MeasuredPath = keyof typeof MEASURED_BYTES_PER_FRAME;

function isMeasuredPath(name: AllocPathName): name is MeasuredPath {
  return Object.prototype.hasOwnProperty.call(MEASURED_BYTES_PER_FRAME, name);
}

/** Every path at its recorded value, except `path` at `bytesPerFrame`. */
function recordedRunWith(
  recorded: AllocThresholds,
  path: MeasuredPath,
  bytesPerFrame: number,
): AllocMeasurement[] {
  return PATHS.map((name) => ({
    path: name,
    bytesPerFrame: name === path ? bytesPerFrame : recorded.paths[name].bytesPerFrame,
    bytesPerEntityFrame: recorded.paths[name].bytesPerEntityFrame,
  }));
}

/** The gate result of the real thresholds file for a run 1025 B/frame above today's value. */
function overBudget(path: MeasuredPath): AllocGateReport {
  const recorded = parseAllocThresholds(recordedFile);
  const bytes = MEASURED_BYTES_PER_FRAME[path] + 1025;
  return evaluateAllocGate(recordedRunWith(recorded, path, bytes), recorded, 22);
}

describe("recorded alloc thresholds", () => {
  it("frame.empty fails 1025 B/frame above its measured value", () => {
    const report = overBudget("frame.empty");
    expect(report.failures.map((f) => `${f.path} ${f.metric}`)).toEqual([
      "frame.empty bytesPerFrame",
    ]);
  });

  it("query.raw fails 1025 B/frame above its measured value", () => {
    const report = overBudget("query.raw");
    expect(report.failures.map((f) => `${f.path} ${f.metric}`)).toEqual([
      "query.raw bytesPerFrame",
    ]);
  });

  it("query.entities fails 1025 B/frame above its measured value", () => {
    const report = overBudget("query.entities");
    expect(report.failures.map((f) => `${f.path} ${f.metric}`)).toEqual([
      "query.entities bytesPerFrame",
    ]);
  });

  it("bulk.query fails 1025 B/frame above its measured value", () => {
    const report = overBudget("bulk.query");
    expect(report.failures.map((f) => `${f.path} ${f.metric}`)).toEqual([
      "bulk.query bytesPerFrame",
    ]);
  });

  it("bulk.components fails 1025 B/frame above its measured value", () => {
    const report = overBudget("bulk.components");
    expect(report.failures.map((f) => `${f.path} ${f.metric}`)).toEqual([
      "bulk.components bytesPerFrame",
    ]);
  });

  it("the measured values pass and none of them can be lowered", () => {
    const recorded = parseAllocThresholds(recordedFile);
    const run = PATHS.map((name) => ({
      path: name,
      bytesPerFrame: isMeasuredPath(name)
        ? MEASURED_BYTES_PER_FRAME[name]
        : recorded.paths[name].bytesPerFrame,
      bytesPerEntityFrame: recorded.paths[name].bytesPerEntityFrame,
    }));
    const report = evaluateAllocGate(run, recorded, 22);
    expect(report.failures).toEqual([]);
    expect(report.lowerable).toEqual([]);
  });
});

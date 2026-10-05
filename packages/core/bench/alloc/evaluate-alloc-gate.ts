/**
 * Pure allocation-gate comparison. No engine, no timers.
 * The alloc suite prints `messages`; a lowerable row does not fail the run.
 */

export const ALLOC_PATH_NAMES = [
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
] as const;

export type AllocPathName = (typeof ALLOC_PATH_NAMES)[number];

export type AllocMetric = "bytesPerFrame" | "bytesPerEntityFrame";

export interface AllocRunConfig {
  warmupFrames: number;
  frames: number;
  repeats: number;
}

export interface AllocPathThreshold {
  bytesPerFrame: number;
  bytesPerEntityFrame: number;
  frames?: number;
}

export interface AllocThresholds {
  version: 1;
  nodeMajor: number;
  entities: [number, number];
  run: AllocRunConfig;
  margins: { bytesPerFrame: number; bytesPerEntityFrame: number };
  paths: Partial<Record<AllocPathName, AllocPathThreshold>> &
    Record<string, AllocPathThreshold | undefined>;
}

export interface AllocMeasurement {
  path: AllocPathName;
  bytesPerFrame: number;
  bytesPerEntityFrame: number;
}

export interface AllocGateFailure {
  path: AllocPathName;
  metric: AllocMetric;
  recorded: number;
  measured: number;
  limit: number;
}

export interface AllocGateLowerable {
  path: AllocPathName;
  metric: AllocMetric;
  recorded: number;
  measured: number;
}

export interface AllocGateReport {
  verdict: "pass" | "fail";
  failures: AllocGateFailure[];
  lowerable: AllocGateLowerable[];
  /** Exact lines the suite prints. Missing paths and the Node check live here. */
  messages: string[];
}

const PATH_SET = new Set<string>(ALLOC_PATH_NAMES);

export function formatAllocNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

export function formatAllocFailure(
  failure: AllocGateFailure,
  thresholds: AllocThresholds,
  nodeMajor: number,
): string {
  const frames = thresholds.paths[failure.path]?.frames ?? thresholds.run.frames;
  const [e1, e2] = thresholds.entities;
  return (
    `[ALLOC GATE] ${failure.path} ${failure.metric}: ` +
    `recorded ${formatAllocNumber(failure.recorded)} → measured ${formatAllocNumber(failure.measured)} ` +
    `(limit ${formatAllocNumber(failure.limit)}, E=${e1}→${e2}, ${frames} frames, Node ${nodeMajor})`
  );
}

function formatLowerable(row: AllocGateLowerable): string {
  return (
    `[ALLOC GATE] ${row.path} ${row.metric}: can be lowered ` +
    `(recorded ${formatAllocNumber(row.recorded)} → measured ${formatAllocNumber(row.measured)})`
  );
}

export function evaluateAllocGate(
  measured: AllocMeasurement[],
  thresholds: AllocThresholds,
  nodeMajor: number,
): AllocGateReport {
  if (nodeMajor !== thresholds.nodeMajor) {
    return {
      verdict: "fail",
      failures: [],
      lowerable: [],
      messages: [
        `[ALLOC GATE] Node major ${nodeMajor} != recorded ${thresholds.nodeMajor}. Re-record thresholds on Node ${nodeMajor}.`,
      ],
    };
  }

  const messages: string[] = [];
  for (const path of ALLOC_PATH_NAMES) {
    if (thresholds.paths[path] === undefined) {
      messages.push(`[ALLOC GATE] ${path}: no recorded threshold`);
    }
  }
  for (const key of Object.keys(thresholds.paths)) {
    if (!PATH_SET.has(key)) {
      messages.push(`[ALLOC GATE] ${key}: no recorded threshold`);
    }
  }

  const byPath = new Map<AllocPathName, AllocMeasurement>();
  for (const row of measured) byPath.set(row.path, row);

  const failures: AllocGateFailure[] = [];
  const lowerable: AllocGateLowerable[] = [];
  const marginBpf = thresholds.margins.bytesPerFrame;
  const marginSlope = thresholds.margins.bytesPerEntityFrame;

  for (const path of ALLOC_PATH_NAMES) {
    const recorded = thresholds.paths[path];
    const sample = byPath.get(path);
    if (recorded === undefined || sample === undefined) continue;
    compare(
      path,
      "bytesPerFrame",
      sample.bytesPerFrame,
      recorded.bytesPerFrame,
      marginBpf,
      failures,
      lowerable,
    );
    compare(
      path,
      "bytesPerEntityFrame",
      sample.bytesPerEntityFrame,
      recorded.bytesPerEntityFrame,
      marginSlope,
      failures,
      lowerable,
    );
  }

  const problems = messages.length;
  for (const failure of failures) messages.push(formatAllocFailure(failure, thresholds, nodeMajor));
  for (const row of lowerable) messages.push(formatLowerable(row));

  return {
    verdict: failures.length > 0 || problems > 0 ? "fail" : "pass",
    failures,
    lowerable,
    messages,
  };
}

function compare(
  path: AllocPathName,
  metric: AllocMetric,
  measured: number,
  recorded: number,
  margin: number,
  failures: AllocGateFailure[],
  lowerable: AllocGateLowerable[],
): void {
  const limit = recorded + margin;
  if (measured > limit) {
    failures.push({ path, metric, recorded, measured, limit });
    return;
  }
  if (measured < recorded - margin) {
    lowerable.push({ path, metric, recorded, measured });
  }
}

import {
  ALLOC_PATH_NAMES,
  type AllocMeasurement,
  type AllocPathName,
  type AllocRunConfig,
  type AllocThresholds,
} from "./evaluate-alloc-gate";
import { measureFrameAllocations } from "./measure";
import { createScenario, type ScenarioOptions } from "./scenarios";

export function runningNodeMajor(): number {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major)) {
    throw new Error(`[ALLOC GATE] unreadable Node version ${process.versions.node}`);
  }
  return major;
}

export function configFor(path: AllocPathName, thresholds: AllocThresholds): AllocRunConfig {
  const frames = thresholds.paths[path]?.frames ?? thresholds.run.frames;
  return {
    warmupFrames: thresholds.run.warmupFrames,
    frames,
    repeats: thresholds.run.repeats,
  };
}

export async function measurePath(
  path: AllocPathName,
  thresholds: AllocThresholds,
  options?: ScenarioOptions,
): Promise<AllocMeasurement> {
  const cfg = configFor(path, thresholds);
  if (path === "pool.cycle" && (cfg.warmupFrames % 2 !== 0 || cfg.frames % 2 !== 0)) {
    throw new Error("[ALLOC GATE] pool.cycle: warmupFrames and frames must be even");
  }
  const e1 = thresholds.entities[0];
  const e2 = thresholds.entities[1];
  if (e1 === undefined || e2 === undefined || e2 === e1) {
    throw new Error("[ALLOC GATE] thresholds.entities must be [E1, E2]");
  }
  const scenario = createScenario(path, options);
  const bytesAtE1 = await measureFrameAllocations(scenario, e1, cfg);
  const bytesAtE2 = await measureFrameAllocations(scenario, e2, cfg);
  return {
    path,
    bytesPerFrame: bytesAtE1,
    bytesPerEntityFrame: (bytesAtE2 - bytesAtE1) / (e2 - e1),
  };
}

export function eachAllocPath(): readonly AllocPathName[] {
  return ALLOC_PATH_NAMES;
}

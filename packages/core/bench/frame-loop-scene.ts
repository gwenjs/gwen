/**
 * One reference scene for the two frame-loop benches.
 *
 * Component fixtures match #74 `STORAGE_REFERENCE_SCENE` (Position, Velocity,
 * Health, Enemy → 4 archetypes). #74 has not merged, so this module is the
 * single definition. N = 50 000 is the frame-loop extension.
 *
 * QueryChunk does not exist on this branch (#65). The onUpdate loop uses
 * today's `useQuery` entity accessor. Transforms live in the WASM layout;
 * Position / Velocity / Health / Enemy live in the TypeScript registry.
 * `createRealEngine` does not accept `debug` (#70). The bench sets the field
 * before sampling.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineComponent, Types } from "../src/index.js";
import type { EngineFramePhaseMs, GwenEngine, GwenPlugin } from "../src/index.js";
import { defineSystem, onRender, onUpdate, useQuery } from "../src/system/index.js";
import { createRealEngine, type RealEngineHandle } from "../tests/integration-wasm/harness.js";

export const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

export const Velocity = defineComponent({
  name: "Velocity",
  schema: { vx: Types.f32, vy: Types.f32 },
});

export const Health = defineComponent({
  name: "Health",
  schema: { current: Types.f32, max: Types.f32 },
});

export const Enemy = defineComponent({
  name: "Enemy",
  schema: {},
});

export const FRAME_LOOP_ENTITY_COUNTS = [1_000, 10_000, 50_000] as const;
export const FRAME_LOOP_MAX_ENTITIES = 65_536;
export const FRAME_LOOP_DT = 1 / 60;
export const FRAME_LOOP_WARMUP = 3;
export const FRAME_LOOP_SAMPLES = 11;
export const FRAME_LOOP_GRID_SPACING = 2;
export const FRAME_LOOP_BOX_HALF = 0.4;
export const FRAME_LOOP_SYSTEM = "FrameLoopReference";

const PHASES = ["tick", "plugins", "wasm", "update", "render", "afterTick", "total"] as const;

export interface FrameScene {
  readonly n: number;
  readonly slots: Uint32Array;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
}

export interface FrameLoopMeasureOptions {
  readonly variant: "light" | "physics2d";
  /** Install plugins. Return their names so the bench can unuse them. */
  readonly install?: (handle: RealEngineHandle, scene: FrameScene) => Promise<readonly string[]>;
  readonly copyFloor?: boolean;
}

let renderSink = 0;
let updateFrames = 0;
let renderFrames = 0;

function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

function cpuModel(): string {
  try {
    return execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim();
  } catch {
    return cpus()[0]?.model ?? "unknown";
  }
}

function machineHeader(variant: "light" | "physics2d"): string {
  const root = repoRoot();
  const osName = execFileSync("uname", ["-srm"], { encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    cwd: root,
  }).trim();
  const wasmPath = fileURLToPath(new URL(`../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url));
  const wasmStat = statSync(wasmPath);
  const wasmArtifact = path.relative(root, wasmPath).split(path.sep).join("/");
  return [
    "GWEN_FRAME_LOOP",
    `cpu=${JSON.stringify(cpuModel())}`,
    `os=${JSON.stringify(osName)}`,
    `node=${JSON.stringify(process.version)}`,
    `commit=${commit}`,
    "wasmScript=scripts/build-wasm.sh wasm-pack build --target web --release",
    `wasmArtifact=${wasmArtifact}`,
    `wasmBytes=${wasmStat.size}`,
    `wasmMtime=${wasmStat.mtime.toISOString()}`,
    `warmup=${FRAME_LOOP_WARMUP}`,
    `samples=${FRAME_LOOP_SAMPLES}`,
    `maxEntities=${FRAME_LOOP_MAX_ENTITIES}`,
    `dt=${FRAME_LOOP_DT}`,
    `gridSpacing=${FRAME_LOOP_GRID_SPACING}`,
    `boxHalf=${FRAME_LOOP_BOX_HALF}`,
  ].join(" ");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function setDebug(engine: GwenEngine, debug: boolean): void {
  // temporary: createRealEngine takes no debug flag, and the logger keeps its construction value
  (engine as { debug: boolean }).debug = debug;
}

function spawnScene(handle: RealEngineHandle, n: number): FrameScene {
  const cols = Math.ceil(Math.sqrt(n));
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const positions = new Float32Array(n * 2);
  for (let index = 0; index < n; index += 1) {
    const x = (index % cols) * FRAME_LOOP_GRID_SPACING;
    const y = Math.floor(index / cols) * FRAME_LOOP_GRID_SPACING;
    xs[index] = x;
    ys[index] = y;
    positions[index * 2] = x;
    positions[index * 2 + 1] = y;
  }
  const slots = handle.bridge.bulkSpawnWithTransforms(positions, new Float32Array(n));
  if (slots.length !== n) {
    throw new Error(`bulkSpawnWithTransforms returned ${slots.length} slots, expected ${n}`);
  }
  const engine = handle.engine;
  for (let index = 0; index < n; index += 1) {
    const id = engine.createEntity();
    const band = index % 4;
    engine.addComponent(id, Position, { x: xs[index] ?? 0, y: ys[index] ?? 0 });
    engine.addComponent(id, Velocity, { vx: 1, vy: 0.5 });
    // Four archetypes: PV, PV+Health, PV+Enemy, PV+Health+Enemy.
    if (band === 0 || band === 1) engine.addComponent(id, Health, { current: 100, max: 100 });
    if (band === 0 || band === 2) engine.addComponent(id, Enemy, {});
  }
  return { n, slots, xs, ys };
}

function referenceSystem(handle: RealEngineHandle, scene: FrameScene): GwenPlugin {
  const wasm = handle.bridge.engine();
  return defineSystem(FRAME_LOOP_SYSTEM, () => {
    const query = useQuery([Position, Velocity]);
    onUpdate((dt) => {
      updateFrames += 1;
      for (const entity of query) {
        const pos = entity.get(Position);
        const vel = entity.get(Velocity);
        if (!pos || !vel) continue;
        pos.x += vel.vx * dt;
        pos.y += vel.vy * dt;
      }
    });
    onRender(() => {
      renderFrames += 1;
      let sum = 0;
      for (let index = 0; index < scene.slots.length; index += 1) {
        const slot = scene.slots[index] ?? 0;
        sum += wasm.get_entity_world_x(slot);
        sum += wasm.get_entity_world_y(slot);
        sum += wasm.get_entity_world_rotation(slot);
      }
      renderSink = sum;
    });
  })();
}

async function samplePhases(handle: RealEngineHandle): Promise<EngineFramePhaseMs> {
  const expected = FRAME_LOOP_WARMUP + FRAME_LOOP_SAMPLES;
  updateFrames = 0;
  renderFrames = 0;
  for (let index = 0; index < FRAME_LOOP_WARMUP; index += 1) {
    await handle.advance(1, FRAME_LOOP_DT);
  }
  const rows: EngineFramePhaseMs[] = [];
  for (let index = 0; index < FRAME_LOOP_SAMPLES; index += 1) {
    await handle.advance(1, FRAME_LOOP_DT);
    rows.push(handle.engine.getStats().phaseMs);
  }
  const phases = {
    tick: 0,
    plugins: 0,
    physics: 0,
    wasm: 0,
    update: 0,
    render: 0,
    afterTick: 0,
    total: 0,
  };
  for (const phase of PHASES) {
    phases[phase] = median(rows.map((row) => row[phase]));
  }
  if (updateFrames !== expected || renderFrames !== expected) {
    throw new Error(
      `frame handlers ran update=${updateFrames} render=${renderFrames}, expected ${expected}`,
    );
  }
  return phases;
}

function writeRow(variant: string, debug: boolean, n: number, phases: EngineFramePhaseMs): void {
  const parts = [
    "GWEN_FRAME_LOOP",
    `variant=${variant}`,
    `debug=${debug}`,
    `N=${n}`,
    ...PHASES.map((phase) => `${phase}=${phases[phase].toFixed(4)}`),
    `renderSink=${renderSink}`,
  ];
  process.stdout.write(`${parts.join(" ")}\n`);
}

function measureCopyFloor(): void {
  for (const count of FRAME_LOOP_ENTITY_COUNTS) {
    for (const multiplier of [1, 2]) {
      const bytes = count * 32 * multiplier;
      const source = new Uint8Array(bytes);
      const target = new Uint8Array(bytes);
      for (let index = 0; index < FRAME_LOOP_WARMUP; index += 1) target.set(source);
      const samples: number[] = [];
      for (let index = 0; index < FRAME_LOOP_SAMPLES; index += 1) {
        const start = performance.now();
        target.set(source);
        samples.push(performance.now() - start);
      }
      process.stdout.write(
        `GWEN_FRAME_LOOP copy N=${count} bytes=${bytes} medianMs=${median(samples).toFixed(4)} sink=${target[0] ?? 0}\n`,
      );
    }
  }
}

// tinybench invokes an async bench once to see that it returns a promise,
// and again for the sample. Keep the first successful pass only.
const measuredKeys = new Set<string>();

function entityCounts(variant: "light" | "physics2d"): readonly number[] {
  // N = 50_000 adds minutes on CI for light and for physics2d. Keep 1_000 and 10_000.
  if ((variant === "light" || variant === "physics2d") && process.env.CI === "true") {
    return [1_000, 10_000];
  }
  return FRAME_LOOP_ENTITY_COUNTS;
}

export async function measureFrameLoop(options: FrameLoopMeasureOptions): Promise<void> {
  const measuredKey = `${options.variant}:${options.copyFloor === true}`;
  if (measuredKeys.has(measuredKey)) return;
  process.stdout.write(`${machineHeader(options.variant)}\n`);
  for (const debug of [true, false]) {
    for (const count of entityCounts(options.variant)) {
      let handle: RealEngineHandle | undefined;
      const names: string[] = [];
      try {
        handle = await createRealEngine({
          variant: options.variant,
          maxEntities: FRAME_LOOP_MAX_ENTITIES,
        });
        setDebug(handle.engine, debug);
        const scene = spawnScene(handle, count);
        if (options.install) names.push(...(await options.install(handle, scene)));
        const system = referenceSystem(handle, scene);
        await handle.engine.use(system);
        names.push(system.name);
        writeRow(options.variant, debug, count, await samplePhases(handle));
      } finally {
        if (handle) {
          try {
            for (const name of [...names].reverse()) await handle.engine.unuse(name);
          } finally {
            await handle.engine.stop();
          }
        }
      }
    }
  }
  if (options.copyFloor) measureCopyFloor();
  measuredKeys.add(measuredKey);
}

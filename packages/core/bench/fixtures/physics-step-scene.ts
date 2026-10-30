/**
 * Real-WASM scene for the physics step bench.
 * The ground uses a slot that is not `create_entity`, so `count_entities` stays N
 * (`crates/gwen-core/src/bindings.rs:214`, `crates/gwen-core/src/bindings.rs:1329`).
 *
 * Bodies sit on that ground, under a kinematic plate. `stepScene` drives the plate
 * with `physics_set_kinematic_position` (`crates/gwen-core/src/bindings.rs:1615`)
 * and `physics3d_set_kinematic_position` (`crates/gwen-core/src/bindings.rs:2851`).
 * There is no can-sleep export. A plate that stays up lets Rapier sleep the row
 * (`crates/gwen-core/src/physics2d/world.rs:287` only clears the spawn flag).
 * Positions stay inside `MAX_WORLD_EXTENT` (`crates/gwen-core/src/physics2d/world.rs:28`).
 * The factory is loaded when `buildScene` runs, for that variant only.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const WARMUP_STEPS = 120;
export const STEP_DT = 1 / 60;

const HALF = 0.4;
const SPACING = 1;
const PLATE_HALF_Y = 0.25;
const PLATE_GAP = 0.02;
const PLATE_AMP = 0.08;
const PLATE_RATE = 30;
const SAMPLE = 32;
const GROUP = 0xffff;
const GROUND_SLOT = 1_900_000;
const PLATE_SLOT = 1_900_001;
const WALL_A = 1_900_002;
const WALL_B = 1_900_003;
const WALL_C = 1_900_004;
const WALL_D = 1_900_005;
const BODY_Y = HALF;
const PLATE_REST_Y = BODY_Y + HALF + PLATE_GAP + PLATE_HALF_Y;

interface EntityHandle {
  readonly index: number;
  free(): void;
}

interface Engine2d {
  create_entity(): EntityHandle;
  count_entities(): number;
  free(): void;
  physics_init(gravityX: number, gravityY: number, maxEntities: number): void;
  physics_step(dt: number): void;
  physics_get_position(slot: number): ArrayLike<number>;
  physics_set_fixed_rotation(slot: number, locked: boolean): void;
  physics_set_kinematic_position(slot: number, x: number, y: number, angle: number): void;
  physics_add_rigid_body(
    slot: number,
    x: number,
    y: number,
    bodyType: number,
    vx: number,
    vy: number,
    angVel: number,
    linearDamping: number,
    angularDamping: number,
    gravityScale: number,
  ): number;
  physics_add_box_collider(
    handle: number,
    halfWidth: number,
    halfHeight: number,
    angle: number,
    friction: number,
    restitution: number,
    density: number,
    groups: number,
    mask: number,
  ): void;
}

interface Engine3d {
  create_entity(): EntityHandle;
  count_entities(): number;
  free(): void;
  physics3d_init(gravityX: number, gravityY: number, gravityZ: number, maxEntities: number): void;
  physics3d_step(dt: number): void;
  physics3d_get_body_state(slot: number): ArrayLike<number>;
  physics3d_lock_rotations(slot: number, x: boolean, y: boolean, z: boolean): void;
  physics3d_lock_translations(slot: number, x: boolean, y: boolean, z: boolean): void;
  physics3d_set_kinematic_position(
    slot: number,
    x: number,
    y: number,
    z: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
  ): void;
  physics3d_add_body(
    slot: number,
    x: number,
    y: number,
    z: number,
    bodyType: number,
    status: number,
    gravityScale: number,
    dominance: number,
  ): void;
  physics3d_add_box_collider(
    slot: number,
    halfX: number,
    halfY: number,
    halfZ: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    sensor: boolean,
    friction: number,
    restitution: number,
    groups: number,
    mask: number,
    density: number,
  ): void;
}

interface Glue {
  initSync(options: { module: Buffer }): void;
  Engine: new (capacity: number) => Engine2d & Engine3d;
}

async function loadGlue(variant: "physics2d" | "physics3d"): Promise<Glue> {
  const href = new URL(`../../wasm/${variant}/gwen_core_factory.js`, import.meta.url);
  const loaded = (await import(/* @vite-ignore */ href.href)) as {
    createGlue: () => Glue;
  };
  return loaded.createGlue();
}

export interface Scene2d {
  readonly variant: "physics2d";
  readonly engine: Engine2d;
  readonly firstDynamicSlot: number;
  readonly sampleSlots: readonly number[];
  free(): void;
}

export interface Scene3d {
  readonly variant: "physics3d";
  readonly engine: Engine3d;
  readonly firstDynamicSlot: number;
  readonly sampleSlots: readonly number[];
  free(): void;
}

export type PhysicsScene = Scene2d | Scene3d;

interface Plate {
  stepIndex: number;
  restY: number;
}

const plates = new WeakMap<PhysicsScene, Plate>();

function wasmBytes(variant: "physics2d" | "physics3d"): Buffer {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  return readFileSync(wasmPath);
}

function columnsOf(variant: "physics2d" | "physics3d", count: number): number {
  if (variant === "physics2d") return Math.max(count, 1);
  return Math.max(Math.ceil(Math.sqrt(count)), 1);
}

function place(index: number, columns: number, rows: number): { x: number; z: number } {
  const spanX = (columns - 1) * SPACING;
  const spanZ = (rows - 1) * SPACING;
  return {
    x: (index % columns) * SPACING - spanX / 2,
    z: Math.floor(index / columns) * SPACING - spanZ / 2,
  };
}

function plateOffset(stepIndex: number): number {
  return Math.sin(stepIndex * STEP_DT * PLATE_RATE - Math.PI / 2) * PLATE_AMP;
}

function createDynamic2d(engine: Engine2d, x: number, y: number): number {
  const id = engine.create_entity();
  const slot = id.index;
  id.free();
  const handle = engine.physics_add_rigid_body(slot, x, y, 1, 1, 1, 0, 0, 0, 0);
  engine.physics_add_box_collider(handle, HALF, HALF, 0, 0.4, 0, 1, GROUP, GROUP);
  engine.physics_set_fixed_rotation(slot, true);
  return slot;
}

function createDynamic3d(engine: Engine3d, x: number, y: number, z: number): number {
  const id = engine.create_entity();
  const slot = id.index;
  id.free();
  engine.physics3d_add_body(slot, x, y, z, 1, 1, 0, 0);
  engine.physics3d_add_box_collider(
    slot,
    HALF,
    HALF,
    HALF,
    0,
    0,
    0,
    false,
    0.4,
    0,
    GROUP,
    GROUP,
    1,
  );
  engine.physics3d_lock_rotations(slot, true, true, true);
  engine.physics3d_lock_translations(slot, true, false, true);
  return slot;
}

function addFixed2d(
  engine: Engine2d,
  slot: number,
  x: number,
  y: number,
  hw: number,
  hh: number,
): void {
  const handle = engine.physics_add_rigid_body(slot, x, y, 0, 0, 0, 0, 0, 0, 0);
  engine.physics_add_box_collider(handle, hw, hh, 0, 0.9, 0, 1, GROUP, GROUP);
}

function addFixed3d(
  engine: Engine3d,
  slot: number,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
): void {
  engine.physics3d_add_body(slot, x, y, z, 0, 0, 0, 0);
  engine.physics3d_add_box_collider(slot, hx, hy, hz, 0, 0, 0, false, 0.9, 0, GROUP, GROUP, 1);
}

async function build2d(count: number): Promise<Scene2d> {
  const glue = await loadGlue("physics2d");
  glue.initSync({ module: wasmBytes("physics2d") });
  const engine = new glue.Engine(Math.max(count, 1));
  try {
    return build2dWith(engine, count);
  } catch (error) {
    engine.free();
    throw error;
  }
}

function build2dWith(engine: Engine2d, count: number): Scene2d {
  engine.physics_init(0, -9.81, count);
  const columns = columnsOf("physics2d", count);
  const rows = Math.ceil(count / columns);
  const spanX = (columns - 1) * SPACING;
  addFixed2d(engine, GROUND_SLOT, 0, -0.5, spanX / 2 + 2, 0.5);
  addFixed2d(engine, WALL_A, -(spanX / 2 + HALF + 0.6), 1, 0.5, 2);
  addFixed2d(engine, WALL_B, spanX / 2 + HALF + 0.6, 1, 0.5, 2);
  const plate = engine.physics_add_rigid_body(PLATE_SLOT, 0, PLATE_REST_Y, 2, 1, 0, 0, 0, 0, 0);
  engine.physics_add_box_collider(
    plate,
    spanX / 2 + HALF,
    PLATE_HALF_Y,
    0,
    0.2,
    0,
    1,
    GROUP,
    GROUP,
  );
  let firstDynamicSlot = 0;
  const sampleSlots: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const cell = place(index, columns, rows);
    const slot = createDynamic2d(engine, cell.x, BODY_Y);
    if (index === 0) firstDynamicSlot = slot;
    if (sampleSlots.length < SAMPLE) sampleSlots.push(slot);
  }
  const scene: Scene2d = {
    variant: "physics2d",
    engine,
    firstDynamicSlot,
    sampleSlots,
    free() {
      engine.free();
    },
  };
  plates.set(scene, { stepIndex: 0, restY: PLATE_REST_Y });
  return scene;
}

async function build3d(count: number): Promise<Scene3d> {
  const glue = await loadGlue("physics3d");
  glue.initSync({ module: wasmBytes("physics3d") });
  const engine = new glue.Engine(Math.max(count, 1));
  try {
    return build3dWith(engine, count);
  } catch (error) {
    engine.free();
    throw error;
  }
}

function build3dWith(engine: Engine3d, count: number): Scene3d {
  engine.physics3d_init(0, -9.81, 0, count);
  const columns = columnsOf("physics3d", count);
  const rows = Math.ceil(count / columns);
  const spanX = (columns - 1) * SPACING;
  const spanZ = (rows - 1) * SPACING;
  addFixed3d(engine, GROUND_SLOT, 0, -0.5, 0, spanX / 2 + 2, 0.5, spanZ / 2 + 2);
  addFixed3d(engine, WALL_A, -(spanX / 2 + HALF + 0.6), 1, 0, 0.5, 2, spanZ / 2 + 2);
  addFixed3d(engine, WALL_B, spanX / 2 + HALF + 0.6, 1, 0, 0.5, 2, spanZ / 2 + 2);
  addFixed3d(engine, WALL_C, 0, 1, -(spanZ / 2 + HALF + 0.6), spanX / 2 + 2, 2, 0.5);
  addFixed3d(engine, WALL_D, 0, 1, spanZ / 2 + HALF + 0.6, spanX / 2 + 2, 2, 0.5);
  engine.physics3d_add_body(PLATE_SLOT, 0, PLATE_REST_Y, 0, 2, 1, 0, 0);
  engine.physics3d_add_box_collider(
    PLATE_SLOT,
    spanX / 2 + HALF,
    PLATE_HALF_Y,
    spanZ / 2 + HALF,
    0,
    0,
    0,
    false,
    0.2,
    0,
    GROUP,
    GROUP,
    1,
  );
  let firstDynamicSlot = 0;
  const sampleSlots: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const cell = place(index, columns, rows);
    const slot = createDynamic3d(engine, cell.x, BODY_Y, cell.z);
    if (index === 0) firstDynamicSlot = slot;
    if (sampleSlots.length < SAMPLE) sampleSlots.push(slot);
  }
  const scene: Scene3d = {
    variant: "physics3d",
    engine,
    firstDynamicSlot,
    sampleSlots,
    free() {
      engine.free();
    },
  };
  plates.set(scene, { stepIndex: 0, restY: PLATE_REST_Y });
  return scene;
}

export async function buildScene(variant: string, count: number): Promise<PhysicsScene> {
  if (variant === "physics2d") return build2d(count);
  if (variant === "physics3d") return build3d(count);
  throw new Error(`unknown variant: ${variant}`);
}

export function stepScene(scene: PhysicsScene): void {
  const plate = plates.get(scene);
  if (plate) {
    const y = plate.restY + plateOffset(plate.stepIndex);
    plate.stepIndex += 1;
    if (scene.variant === "physics2d") {
      scene.engine.physics_set_kinematic_position(PLATE_SLOT, 0, y, 0);
    } else {
      scene.engine.physics3d_set_kinematic_position(PLATE_SLOT, 0, y, 0, 0, 0, 0, 1);
    }
  }
  if (scene.variant === "physics2d") {
    scene.engine.physics_step(STEP_DT);
    return;
  }
  scene.engine.physics3d_step(STEP_DT);
}

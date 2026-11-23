/**
 * Collider layer and mask on a real physics3d engine.
 * Actors pass the filter through useBoxCollider and useConvexCollider.
 * An excluded mask produces no contact. An included mask does.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import type { LayerSelector } from "@gwenjs/physics-core";
import { defineActor, definePrefab, useEntityId } from "../../src/actor/index.js";
import { defineComponent, Types, type EntityId } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { onContact } from "../../../physics3d/src/composables/on-contact.js";
import { useDynamicBody } from "../../../physics3d/src/composables/use-dynamic-body";
import { useStaticBody } from "../../../physics3d/src/composables/use-static-body";
import { useBoxCollider } from "../../../physics3d/src/composables/use-box-collider";
import { useConvexCollider } from "../../../physics3d/src/composables/use-convex-collider";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics3d: Physics3DAPI;
  }
}

const LAYER_HINT = "Add it to Physics3DConfig.layers or fix the typo.";
const DT = 1 / 60;
const CONTACT_FRAMES = 8;

const Marker = defineComponent({
  name: "Physics3dLayersMarker",
  schema: { v: Types.u32 },
});

const Prefab = definePrefab([{ def: Marker, defaults: { v: 1 } }]);

interface BoxProps {
  x: number;
  y: number;
  z: number;
  layer: LayerSelector;
  mask: LayerSelector;
  gravityScale: number;
  dynamic: boolean;
  w: number;
  h: number;
  d: number;
}

const BoxActor = defineActor(Prefab, (props: BoxProps): { id: EntityId } => {
  const id = useEntityId();
  if (props.dynamic) {
    useDynamicBody({
      mass: 1,
      gravityScale: props.gravityScale,
      linearDamping: 0,
      initialPosition: { x: props.x, y: props.y, z: props.z },
    });
  } else {
    useStaticBody();
  }
  useBoxCollider({
    w: props.w,
    h: props.h,
    d: props.d,
    layer: props.layer,
    mask: props.mask,
  });
  return { id };
});

/** Eight corners of a box. The hull matches a box of the same half-extent. */
function boxCorners(half: number): Float32Array {
  const h = half;
  return new Float32Array([
    -h,
    -h,
    -h,
    h,
    -h,
    -h,
    h,
    h,
    -h,
    -h,
    h,
    -h,
    -h,
    -h,
    h,
    h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    h,
    h,
  ]);
}

interface ConvexProps {
  x: number;
  layer: LayerSelector;
  mask: LayerSelector;
}

const ConvexActor = defineActor(Prefab, (props: ConvexProps): { id: EntityId } => {
  const id = useEntityId();
  useDynamicBody({
    mass: 1,
    gravityScale: 0,
    linearDamping: 0,
    initialPosition: { x: props.x, y: 2, z: 0 },
  });
  useConvexCollider({
    vertices: boxCorners(0.5),
    layer: props.layer,
    mask: props.mask,
  });
  return { id };
});

const LAYERS = { solid: 0, ghost: 1 } as const;

async function countStarted(
  plugin: ReturnType<typeof Physics3DPlugin>,
  spawn: (engine: Awaited<ReturnType<typeof createRealEngine>>["engine"]) => void,
  frames: number,
): Promise<number> {
  const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
  try {
    const { engine, advance } = handle;
    await engine.use(plugin);
    await engine.use(BoxActor._plugin);
    let started = 0;
    engine.run(() => {
      onContact((contact) => {
        if (contact.started) started += 1;
      });
    });
    spawn(engine);
    await advance(frames, DT);
    return started;
  } finally {
    await handle.dispose();
  }
}

function spawnPair(left: { layer: LayerSelector; mask: LayerSelector }, right: typeof left) {
  return (engine: Awaited<ReturnType<typeof createRealEngine>>["engine"]): void => {
    void engine;
    BoxActor._plugin.spawn({
      x: 0,
      y: 2,
      z: 0,
      layer: left.layer,
      mask: left.mask,
      gravityScale: 0,
      dynamic: true,
      w: 1,
      h: 1,
      d: 1,
    });
    BoxActor._plugin.spawn({
      x: 0.2,
      y: 2,
      z: 0,
      layer: right.layer,
      mask: right.mask,
      gravityScale: 0,
      dynamic: true,
      w: 1,
      h: 1,
      d: 1,
    });
  };
}

function zeroGravity(): ReturnType<typeof Physics3DPlugin> {
  return Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 }, layers: LAYERS });
}

function positionY(physics: Physics3DAPI, id: EntityId): number {
  const state = physics.getBodyState(id);
  if (state?.position === null || state?.position === undefined) {
    throw new Error("expected a physics body position");
  }
  return state.position.y;
}

describe("physics3d layers on a real engine", () => {
  it("an excluded mask produces no contact and an included mask does", async () => {
    const excluded = await countStarted(
      zeroGravity(),
      spawnPair({ layer: "solid", mask: ["solid"] }, { layer: "ghost", mask: ["ghost"] }),
      CONTACT_FRAMES,
    );
    const included = await countStarted(
      zeroGravity(),
      spawnPair(
        { layer: "solid", mask: ["solid", "ghost"] },
        { layer: "ghost", mask: ["solid", "ghost"] },
      ),
      CONTACT_FRAMES,
    );
    expect(excluded).toBe(0);
    expect(included).toBeGreaterThan(0);
  });

  it("a raw numeric layer and mask filter the same way", async () => {
    const solid = 1 << 0;
    const ghost = 1 << 1;
    const both = solid | ghost;
    const excluded = await countStarted(
      zeroGravity(),
      spawnPair({ layer: solid, mask: solid }, { layer: ghost, mask: ghost }),
      CONTACT_FRAMES,
    );
    const included = await countStarted(
      zeroGravity(),
      spawnPair({ layer: solid, mask: both }, { layer: ghost, mask: both }),
      CONTACT_FRAMES,
    );
    // Membership of every bit, filter of solid only: a ghost does not pass.
    const fullLayer = await countStarted(
      zeroGravity(),
      spawnPair({ layer: 0xffffffff, mask: solid }, { layer: ghost, mask: 0xffffffff }),
      CONTACT_FRAMES,
    );
    const emptyMask = await countStarted(
      zeroGravity(),
      spawnPair({ layer: "solid", mask: [] }, { layer: "ghost", mask: [] }),
      CONTACT_FRAMES,
    );
    expect(excluded).toBe(0);
    expect(included).toBeGreaterThan(0);
    expect(fullLayer).toBe(0);
    expect(emptyMask).toBeGreaterThan(0);
  });

  it("a dynamic box whose mask excludes the ground falls through it", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(
        Physics3DPlugin({
          gravity: { x: 0, y: -9.81, z: 0 },
          layers: LAYERS,
        }),
      );
      await engine.use(BoxActor._plugin);
      BoxActor._plugin.spawn({
        x: 0,
        y: 0,
        z: 0,
        layer: "solid",
        mask: ["solid"],
        gravityScale: 0,
        dynamic: false,
        w: 40,
        h: 1,
        d: 40,
      });
      const fallingId = BoxActor._plugin.spawn({
        x: -6,
        y: 2,
        z: 0,
        layer: "solid",
        mask: ["ghost"],
        gravityScale: 1,
        dynamic: true,
        w: 1,
        h: 1,
        d: 1,
      });
      const restingId = BoxActor._plugin.spawn({
        x: 6,
        y: 2,
        z: 0,
        layer: "solid",
        mask: ["solid"],
        gravityScale: 1,
        dynamic: true,
        w: 1,
        h: 1,
        d: 1,
      });
      await advance(120, DT);
      const physics = engine.inject("physics3d");
      const falling = BoxActor._instances.get(fallingId)?.api;
      const resting = BoxActor._instances.get(restingId)?.api;
      if (falling === undefined || resting === undefined) {
        throw new Error("expected both actor instances");
      }
      expect(positionY(physics, falling.id)).toBeLessThan(0);
      const rested = positionY(physics, resting.id);
      expect(rested).toBeGreaterThan(0.5);
      expect(rested).toBeLessThan(2);
    } finally {
      await handle.dispose();
    }
  });

  it("an unknown layer name throws PHYSICS3D:UNKNOWN_LAYER from useBoxCollider", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine } = handle;
      await engine.use(
        Physics3DPlugin({
          gravity: { x: 0, y: 0, z: 0 },
          layers: { solid: 0 },
        }),
      );
      await engine.use(BoxActor._plugin);
      let caught: unknown;
      try {
        BoxActor._plugin.spawn({
          x: 0,
          y: 2,
          z: 0,
          layer: "missing",
          mask: "solid",
          gravityScale: 0,
          dynamic: true,
          w: 1,
          h: 1,
          d: 1,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe("PHYSICS3D:UNKNOWN_LAYER");
      expect(caught.message).toContain(
        'Unknown layer "missing" in layer. Declared layers: [solid].',
      );
      expect(caught.hint).toBe(__GWEN_DEV__ ? LAYER_HINT : undefined);
    } finally {
      await handle.dispose();
    }
  });

  it("a convex collider with an excluded mask produces no contact", async () => {
    async function convexContacts(includeOther: boolean): Promise<number> {
      const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
      try {
        const { engine, advance } = handle;
        await engine.use(zeroGravity());
        await engine.use(ConvexActor._plugin);
        const mask: LayerSelector = includeOther ? ["solid", "ghost"] : ["solid"];
        const other: LayerSelector = includeOther ? ["solid", "ghost"] : ["ghost"];
        let started = 0;
        engine.run(() => {
          onContact((contact) => {
            if (contact.started) started += 1;
          });
        });
        ConvexActor._plugin.spawn({ x: 0, layer: "solid", mask });
        ConvexActor._plugin.spawn({ x: 0.2, layer: "ghost", mask: other });
        await advance(CONTACT_FRAMES, DT);
        return started;
      } finally {
        await handle.dispose();
      }
    }

    expect(await convexContacts(false)).toBe(0);
    expect(await convexContacts(true)).toBeGreaterThan(0);
  });
});

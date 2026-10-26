import { describe, expect, it } from "vitest";

import { defineComponent, Types } from "../../src/schema";
import type { EntityId } from "../../src/types/entity.js";
import { defineActor, definePrefab, useActor } from "../../src/actor/index";
import { useQuery } from "../../src/system/index";
import { createRealEngine } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI, Physics3DColliderOptions } from "../../../physics3d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

const OVERLAP_BOX: Physics3DColliderOptions = {
  shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
  colliderId: 0,
};

const Marker2D = defineComponent({
  name: "PrefabPhysicsMarker278",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const Marker3D = defineComponent({
  name: "PrefabPhysics3dMarker278",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

describe("prefab physics extensions", () => {
  it("a prefab with a physics extension gets a 2D body", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine } = handle;
      const reported: string[] = [];
      const off = engine.errors.on((event) => {
        reported.push(event.message);
      });
      try {
        const prefab = definePrefab([{ def: Marker2D, defaults: { x: 0 } }], {
          extensions: {
            physics: {
              bodyType: "dynamic",
              colliders: [{ shape: "ball", radius: 8 }],
            },
          },
        });
        const Actor = defineActor(prefab, () => ({}));
        await engine.use(Physics2DPlugin({ gravity: 0 }));
        await engine.use(Actor._plugin);
        const id = engine.run(() => useActor(Actor).spawn());
        expect(reported).toEqual([]);
        expect(engine.inject("physics2d").getPosition(id)).not.toBeNull();
      } finally {
        off();
      }
    } finally {
      await handle.dispose();
    }
  });

  it("a prefab spawned inside a chunk loop gets a 2D body", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine } = handle;
      const reported: string[] = [];
      const off = engine.errors.on((event) => {
        reported.push(event.message);
      });
      try {
        const prefab = definePrefab([{ def: Marker2D, defaults: { x: 0 } }], {
          extensions: {
            physics: {
              bodyType: "dynamic",
              colliders: [{ shape: "ball", radius: 8 }],
            },
          },
        });
        const Actor = defineActor(prefab, () => ({}));
        await engine.use(Physics2DPlugin({ gravity: 0 }));
        await engine.use(Actor._plugin);
        const anchor = engine.createEntity();
        engine.addComponent(anchor, Marker2D, { x: 0 });
        const query = engine.run(() => useQuery([Marker2D]));
        let id: EntityId | undefined;
        for (const _chunk of query) {
          id = engine.run(() => useActor(Actor).spawn());
          break;
        }
        expect(reported).toEqual([]);
        if (id === undefined) throw new Error("missing id");
        expect(engine.inject("physics2d").getPosition(id)).not.toBeNull();
      } finally {
        off();
      }
    } finally {
      await handle.dispose();
    }
  });

  it("a prefab with a physics3d extension gets a 3D body", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const { engine } = handle;
      const reported: string[] = [];
      const off = engine.errors.on((event) => {
        reported.push(event.message);
      });
      try {
        const prefab = definePrefab([{ def: Marker3D, defaults: { x: 0 } }], {
          extensions: {
            physics3d: {
              body: {
                kind: "dynamic",
                colliders: [OVERLAP_BOX],
              },
            },
          },
        });
        const Actor = defineActor(prefab, () => ({}));
        await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
        await engine.use(Actor._plugin);
        const id = engine.run(() => useActor(Actor).spawn());
        expect(reported).toEqual([]);
        expect(engine.inject("physics3d").hasBody(id)).toBe(true);
      } finally {
        off();
      }
    } finally {
      await handle.dispose();
    }
  });
});

/* oxlint-disable no-unused-vars -- type fixture: the checker is the assertion */

import type * as Root from "@gwenjs/physics2d";
import type * as T_tilemap from "@gwenjs/physics2d/tilemap";
import type * as T_debug from "@gwenjs/physics2d/debug";
import type * as T_internal from "@gwenjs/physics2d/internal";

type _0 = [
  Root.BoxColliderHandle,
  Root.BoxColliderOptions,
  Root.CapsuleColliderHandle,
  Root.CapsuleColliderOptions,
  Root.CircleColliderHandle,
  Root.ColliderOptions,
  Root.CollisionContact,
  Root.CollisionEvent,
  Root.CollisionEventsBatch,
  Root.ContactEvent,
  Root.DynamicBodyHandle,
  Root.DynamicBodyOptions,
  Root.KinematicBodyHandle,
  Root.KinematicBodyOptions,
  Root.Physics2DAPI,
  Root.Physics2DConfig,
  Root.Physics2DLayerDefinition,
  Root.Physics2DPluginHooks,
  Root.Physics2DPrefabExtension,
  Root.PhysicsColliderDef,
  Root.PhysicsColliderShape,
  Root.PhysicsKinematicSyncSystemOptions,
  Root.PhysicsQualityPreset,
  Root.PlatformerGroundedSystemOptions,
  Root.RigidBodyType,
  Root.SensorState,
  Root.ShapeOptions,
  Root.SphereColliderOptions,
  Root.StaticBodyHandle,
  Root.StaticBodyOptions,
  Root.TilemapPhysicsChunkMap,
];
type _1 = [
  T_tilemap.BuildTilemapPhysicsChunksInput,
  T_tilemap.PatchTilemapPhysicsChunkInput,
  T_tilemap.PhysicsColliderDef,
  T_tilemap.TilemapChunkRect,
  T_tilemap.TilemapPhysicsChunk,
  T_tilemap.TilemapPhysicsChunkMap,
];
type _2 = [T_debug.CollisionEvent];
type _3 = [T_internal.ShapeData];

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { Physics2D } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { physics2D } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { _clearContactCallbacks } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { _clearSensorCallbacks } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { ContactRingBuffer } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { CONTACT_EVENT_BYTES } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { RING_CAPACITY } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { ShapeComponent } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { ShapeData } from "@gwenjs/physics2d";

// @ts-expect-error TS2305 — removed from @gwenjs/physics2d
import { PHYSICS2D_BRIDGE_SCHEMA_VERSION } from "@gwenjs/physics2d";

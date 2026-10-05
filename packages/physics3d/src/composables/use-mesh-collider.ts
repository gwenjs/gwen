/**
 * @file useMeshCollider() — attaches a trimesh collider to the current entity.
 *
 * **3D only — not available in \@gwenjs/physics2d.**
 *
 * A mesh collider uses a triangle mesh for precise concave collision geometry.
 * It is more expensive than convex or primitive shapes, so prefer convex or
 * primitive shapes for dynamic bodies. Mesh colliders are best suited for
 * static terrain and environment geometry.
 *
 * When called with a pre-baked BVH URL (via the `gwen:physics3d` Vite plugin or
 * `preloadMeshCollider`), the load is performed asynchronously. The returned
 * handle exposes `status`, `ready`, and `abort()` to track and control the load.
 */
import type { MeshColliderHandle3D, MeshColliderOptions, Physics3DColliderOptions } from "../types";
import { usePhysics3D } from "../composables";
import { _getActorEntityId } from "@gwenjs/core/internal";
import { nextColliderId } from "./collider-id";
import type { PreloadedBvhHandle } from "../index";

/**
 * Type guard for {@link PreloadedBvhHandle}.
 *
 * @param v - Value to test.
 * @returns `true` when `v` is a `PreloadedBvhHandle`.
 */
function isPreloadedBvhHandle(v: unknown): v is PreloadedBvhHandle {
  return typeof v === "object" && v !== null && "url" in v && "status" in v;
}

/**
 * Attach a trimesh collider to the current entity.
 *
 * **3D only — not available in \@gwenjs/physics2d.**
 *
 * Must be called after {@link useStaticBody} or {@link useDynamicBody} has
 * registered the body for this entity. Mesh colliders are recommended for
 * static bodies only; using them on dynamic bodies incurs significant performance
 * overhead in the Rapier3D solver.
 *
 * @param options - Vertex/index arrays, a pre-baked BVH URL, or a
 *   {@link PreloadedBvhHandle} returned by `preloadMeshCollider`.
 * @returns A {@link MeshColliderHandle3D} with `colliderId`, `remove()`,
 *   `status`, `ready`, and `abort()`.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * // Synchronous — inline mesh data
 * const TerrainActor = defineActor(TerrainPrefab, () => {
 *   useStaticBody()
 *   useMeshCollider({ vertices: terrainVerts, indices: terrainIndices })
 * })
 *
 * // Async — pre-baked BVH (Vite plugin rewrites the string argument automatically)
 * const TerrainActor = defineActor(TerrainPrefab, () => {
 *   useStaticBody()
 *   const { ready } = useMeshCollider('./terrain.glb')
 *   ready.then(() => console.log('terrain collider active'))
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useMeshCollider(
  options: MeshColliderOptions | PreloadedBvhHandle,
): MeshColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId();
  const colliderId = nextColliderId();

  // Normalise: PreloadedBvhHandle → MeshColliderOptions
  const opts: MeshColliderOptions = isPreloadedBvhHandle(options)
    ? { __bvhUrl: options.url }
    : options;

  // Tracks current collider options so rebuild() can inherit material settings.
  let currentOptions: MeshColliderOptions = opts;

  const isAsync = Boolean(opts.__bvhUrl);

  // ── Status / ready / abort tracking ──────────────────────────────────────────

  let _status: MeshColliderHandle3D["status"] = isAsync ? "loading" : "active";

  // For the sync path, ready is immediately resolved
  let _ready: Promise<void> = Promise.resolve();
  let _abortFn: () => void = () => {
    // no-op for synchronous colliders
  };

  const collider: Physics3DColliderOptions = {
    shape: {
      type: "mesh",
      // Provide empty buffers as placeholders when using the async BVH path
      vertices: opts.vertices ?? new Float32Array(0),
      indices: opts.indices ?? new Uint32Array(0),
    },
    colliderId,
    ...(opts.isSensor !== undefined ? { isSensor: opts.isSensor } : {}),
    ...(opts.offsetX !== undefined ? { offsetX: opts.offsetX } : {}),
    ...(opts.offsetY !== undefined ? { offsetY: opts.offsetY } : {}),
    ...(opts.offsetZ !== undefined ? { offsetZ: opts.offsetZ } : {}),
    ...(opts.__bvhUrl !== undefined ? { __bvhUrl: opts.__bvhUrl } : {}),
  };
  physics.addCollider(entityId, collider);

  if (isAsync) {
    // Get the pending load state that addCollider registered
    const pending = physics._getBvhLoadState(colliderId);
    if (pending) {
      _ready = pending.ready.then(
        () => {
          _status = "active";
        },
        () => {
          _status = "error";
        },
      );
      _abortFn = () => {
        pending.abort();
        _status = "error";
      };
    }
  }

  return {
    get colliderId() {
      return colliderId;
    },
    get status() {
      return _status;
    },
    get ready() {
      return _ready;
    },
    abort() {
      _abortFn();
    },
    async rebuild(vertices: Float32Array, indices: Uint32Array): Promise<void> {
      // RFC-06c: replace the await below with a Worker-based BVH build.
      // The Worker receives vertices + indices, pre-computes the BVH off-thread,
      // then returns processed data. On response, call rebuildMeshCollider.
      //
      // Current implementation: synchronous WASM call (blocks main thread briefly
      // for large meshes — acceptable until RFC-06c is integrated).
      currentOptions = { ...currentOptions, vertices, indices };
      _status = "loading";
      const rebuildOpts: Pick<
        Physics3DColliderOptions,
        "isSensor" | "friction" | "restitution" | "layers" | "mask"
      > = {};
      if (currentOptions.isSensor !== undefined) rebuildOpts.isSensor = currentOptions.isSensor;
      const ok = physics.rebuildMeshCollider(entityId, colliderId, vertices, indices, rebuildOpts);
      if (!ok) {
        _status = "error";
        throw new Error(
          `physics3d_rebuild_mesh_collider failed for entity ${String(entityId)}, colliderId ${colliderId}`,
        );
      }
      _status = "active";
    },
    remove() {
      physics.removeCollider(entityId, colliderId);
    },
  };
}

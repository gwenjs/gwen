// ─── BVH fetch cache (module-level — shared across plugin instances) ────────────

import { Physics3DErrorCodes } from '../errors/codes';

/**
 * Cache mapping BVH asset URL to its in-flight or resolved fetch Promise.
 * Deduplicates concurrent fetches for the same URL across multiple `useMeshCollider`
 * calls and `preloadMeshCollider` calls.
 */
const _bvhCache = new Map<string, Promise<ArrayBuffer>>();

/**
 * Fetch a pre-baked BVH binary, deduplicating concurrent requests for the same URL.
 *
 * @param url - Absolute or relative URL to the `.bin` BVH asset.
 * @returns A Promise that resolves with the raw `ArrayBuffer`.
 * @throws When the HTTP response status is not OK.
 *
 * @internal
 */
export function _fetchBvhBuffer(url: string): Promise<ArrayBuffer> {
  if (!_bvhCache.has(url)) {
    _bvhCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`[GWEN:Physics3D] BVH fetch failed: ${r.status} ${url}`);
        return r.arrayBuffer();
      }),
    );
  }
  return _bvhCache.get(url)!;
}

/**
 * Clear the module-level BVH fetch cache.
 *
 * @internal Test helper — clears the SharedShape cache so test cases are isolated.
 */
export function _clearBvhCache(): void {
  _bvhCache.clear();
}

// ─── BVH worker (module-level — lazy singleton) ───────────────────────────────

/**
 * Minimum triangle count at which the async BVH worker is preferred over the
 * synchronous `physics3d_add_mesh_collider` path.
 *
 * 500 triangles is empirically where the synchronous Rapier QBVH construction
 * time exceeds ~1 ms on mid-range hardware, risking a visible frame spike on
 * the first collider add. Below this threshold the sync path is cheaper because
 * it avoids Worker instantiation and message-passing overhead.
 */
export const BVH_WORKER_THRESHOLD = 500;

/** Lazy BVH worker singleton — created on first large-mesh collider add. */
let _bvhWorker: Worker | null = null;

/** Monotonically-increasing job id for the BVH worker. */
let _bvhWorkerNextId = 0;

/** Pending BVH worker callbacks keyed by job id. */
export const _bvhWorkerCallbacks = new Map<
  number,
  {
    resolve: (bytes: Uint8Array) => void;
    reject: (err: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

/** Get (or lazily create) the module-level BVH worker. */
export function getBvhWorker(): Worker {
  if (!_bvhWorker) {
    _bvhWorker = new Worker(new URL('./bvh-worker.ts', import.meta.url), { type: 'module' });
    _bvhWorker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; bvhBytes: Uint8Array | null; error: string | null }>) => {
      const cb = _bvhWorkerCallbacks.get(data.id);
      if (!cb) return;
      clearTimeout(cb.timeoutId);
      _bvhWorkerCallbacks.delete(data.id);
      if (data.error || !data.bvhBytes) {
        cb.reject(new Error(data.error ?? '[GWEN:Physics3D] BVH worker returned empty result'));
      } else {
        cb.resolve(data.bvhBytes);
      }
    };
  }
  return _bvhWorker;
}

/** Get the next job ID for a BVH worker job. */
export function getNextBvhJobId(): number {
  return _bvhWorkerNextId++;
}

/**
 * Register a custom callback for a BVH job with automatic timeout handling.
 *
 * @param id - Job ID (from getNextBvhJobId)
 * @param resolve - Callback when BVH worker succeeds
 * @param reject - Callback when BVH worker fails or times out
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 *
 * @internal
 */
export function registerBvhCallback(
  id: number,
  resolve: (bytes: Uint8Array) => void,
  reject: (err: unknown) => void,
  timeoutMs: number = 30_000,
): void {
  const timeoutId = setTimeout(() => {
    _bvhWorkerCallbacks.delete(id);
    reject(
      new Error(
        `[${Physics3DErrorCodes.BVH_WORKER_TIMEOUT}] BVH worker did not respond within ${timeoutMs}ms`,
      ),
    );
  }, timeoutMs);
  _bvhWorkerCallbacks.set(id, { resolve, reject, timeoutId });
}

export function queueBvhJob(vertices: Float32Array, indices: Uint32Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = getNextBvhJobId();
    const timeoutId = setTimeout(() => {
      _bvhWorkerCallbacks.delete(id);
      reject(
        new Error(
          `[${Physics3DErrorCodes.BVH_WORKER_TIMEOUT}] BVH worker did not respond within 30s`,
        ),
      );
    }, 30_000);
    _bvhWorkerCallbacks.set(id, { resolve, reject, timeoutId });
    getBvhWorker().postMessage({ id, vertices, indices });
  });
}

// ─── preloadMeshCollider — open-world BVH streaming ──────────────────────────

/**
 * Handle for a preloaded BVH binary asset.
 *
 * @see {@link preloadMeshCollider}
 */
export interface PreloadedBvhHandle {
  /** Current fetch state of the BVH binary. */
  status: 'loading' | 'ready' | 'error';
  /** The URL being fetched. */
  url: string;
  /**
   * Resolves when the binary is in memory and ready for instant collider creation.
   * Already resolved when `status === 'ready'`.
   */
  ready: Promise<void>;
  /**
   * Cached `ArrayBuffer` once loaded — consumed by `useMeshCollider`.
   * @internal
   */
  _buffer?: ArrayBuffer;
}

/**
 * Start fetching a pre-baked BVH binary before the actor that needs it is spawned.
 *
 * Useful for open-world streaming: preload Zone 2 while the player is still in Zone 1.
 * The returned handle can be passed directly to `useMeshCollider(handle)` — if the
 * binary is already in memory, collider creation is effectively synchronous (no extra
 * network round-trip).
 *
 * @param url - Absolute or root-relative URL to the `.bin` BVH asset emitted by
 *   the `gwen:physics3d` Vite plugin (e.g. `'/assets/bvh-terrain-abc12345.bin'`).
 * @returns A {@link PreloadedBvhHandle} whose `ready` Promise resolves once the
 *   binary is in memory.
 *
 * @example
 * ```typescript
 * // At scene load — kick off the fetch immediately
 * const zone2Bvh = preloadMeshCollider('/assets/bvh-zone2.bin')
 *
 * // Later, when the player approaches Zone 2
 * const Zone2Terrain = defineActor(Zone2Prefab, () => {
 *   useStaticBody()
 *   useMeshCollider(zone2Bvh) // instant if already loaded
 * })
 * ```
 *
 * @since 2.0.0
 */
export function preloadMeshCollider(url: string): PreloadedBvhHandle {
  const handle: PreloadedBvhHandle = {
    status: 'loading',
    url,
    ready: Promise.resolve(),
  };

  handle.ready = _fetchBvhBuffer(url)
    .then((ab) => {
      handle._buffer = ab;
      handle.status = 'ready';
    })
    .catch(() => {
      handle.status = 'error';
    });

  return handle;
}

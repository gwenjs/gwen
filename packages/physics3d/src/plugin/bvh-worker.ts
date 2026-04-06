/**
 * Web Worker for async BVH construction from procedural mesh data.
 *
 * Loaded by `useMeshCollider` when mesh data is provided at runtime (not pre-baked
 * by the Vite plugin). Uses the build-tools WASM to construct a Rapier3D TriMesh
 * BVH off the main thread, then transfers the result back via `postMessage`.
 *
 * **Usage**: instantiate with `new Worker(new URL('./bvh-worker.ts', import.meta.url))`
 * and send `WorkerJob` messages.
 */

// @ts-ignore — dynamic import resolved by bundler at runtime
import initWasm, { build_bvh_buffer } from '../../build-tools/gwen_core.js';

/** Whether the WASM module has finished initialising. */
let wasmReady = false;

/** Jobs queued while WASM is still loading. */
const queue: WorkerJob[] = [];

// Initialise WASM asynchronously; flush the queue when done
// @ts-ignore — initWasm typed from runtime .d.ts; build-tools variant is callable
initWasm().then(() => {
  wasmReady = true;
  queue.splice(0).forEach(processJob);
});

/**
 * A single BVH construction job sent from the main thread.
 */
interface WorkerJob {
  /** Unique job identifier echoed back in the response. */
  id: number;
  /** Flat vertex position array `[x0,y0,z0, ...]`. */
  vertices: Float32Array;
  /** Flat triangle index array `[i0,i1,i2, ...]`. */
  indices: Uint32Array;
}

/**
 * Process a single BVH job and post the result back to the main thread.
 * The `bvhBytes` buffer is transferred (zero-copy) on success.
 *
 * @param job - The BVH construction job to process.
 */
function processJob({ id, vertices, indices }: WorkerJob): void {
  try {
    const bvhBytes: Uint8Array = build_bvh_buffer(vertices, indices);
    self.postMessage({ id, bvhBytes, error: null }, { transfer: [bvhBytes.buffer as ArrayBuffer] });
  } catch (e) {
    self.postMessage({ id, bvhBytes: null, error: String(e) });
  }
}

// Main message handler — queue jobs if WASM isn't ready yet
self.onmessage = ({ data }: MessageEvent<WorkerJob>) => {
  if (!wasmReady) {
    queue.push(data);
    return;
  }
  processJob(data);
};

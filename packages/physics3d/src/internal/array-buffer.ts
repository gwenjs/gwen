import { GwenError } from "@gwenjs/schema";
import { Physics3DErrorCodes } from "../errors/codes";

/**
 * True for a plain `ArrayBuffer`, false for a `SharedArrayBuffer`.
 *
 * Reads the string tag, so an `ArrayBuffer` made in another realm still counts. It narrows
 * `ArrayBufferLike` without a cast. It is not exported from the package entry.
 *
 * @param buffer - The buffer behind a typed array.
 * @returns Whether `buffer` is an `ArrayBuffer`.
 * @internal
 */
export function isArrayBuffer(buffer: ArrayBufferLike): buffer is ArrayBuffer {
  return Object.prototype.toString.call(buffer) === "[object ArrayBuffer]";
}

/**
 * Copies a whole buffer so the copy can be transferred to a worker.
 *
 * A `SharedArrayBuffer` cannot be transferred: it throws here, where a transfer used to
 * fail at `postMessage`. Callers run this inside the `try` that rejects the pending load.
 *
 * @param buffer - The buffer behind a typed array.
 * @returns A transferable copy of the whole `buffer`.
 * @throws {GwenError} `PHYSICS3D:BVH_LOAD_FAILED` if `buffer` is shared.
 * @internal
 */
export function copyForTransfer(buffer: ArrayBufferLike): ArrayBuffer {
  if (isArrayBuffer(buffer)) return buffer.slice(0);
  throw new GwenError(
    Physics3DErrorCodes.BVH_LOAD_FAILED,
    "A SharedArrayBuffer cannot be transferred to the BVH worker.",
  );
}

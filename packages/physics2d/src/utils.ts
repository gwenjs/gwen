/**
 * Simple FNV-1a 32-bit hash implementation.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Derives a unique chunk ID from its key.
 */
export function tilemapChunkIdFromKey(key: string): number {
  return fnv1a32(`tilemap:${key}`);
}

/**
 * Derives a pseudo-entity index from a chunk ID for collision tracking.
 */
export function tilemapPseudoEntityFromChunkId(chunkId: number): number {
  return (chunkId | 0x80000000) >>> 0;
}

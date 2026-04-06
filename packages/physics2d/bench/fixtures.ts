/**
 * Shared fixture utilities for physics2d bench and tests.
 * @module
 */

/**
 * Generates a deterministic synthetic tile map for benchmarking.
 *
 * Creates a terrain-like pattern with:
 * - Ground rows at the bottom (y > height - 5)
 * - Horizontal walls every 11 rows (gaps every 3rd column)
 * - Vertical pillars every 17 columns (3 tiles tall, spaced every 5 rows)
 *
 * @param width - Map width in tiles
 * @param height - Map height in tiles
 * @returns Flat tile array (0 = empty, 1 = solid), length = width * height
 */
export function makeTiles(width: number, height: number): number[] {
  const tiles = Array.from<number>({ length: width * height }).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y > height - 5 || (y % 11 === 0 && x % 3 !== 0) || (x % 17 === 0 && y % 5 < 3)) {
        tiles[y * width + x] = 1;
      }
    }
  }
  return tiles;
}

/**
 * @fileoverview A* pathfinding on a 3D voxel navigation grid.
 *
 * Contains the MinHeap data structure and local-mode pathfinding implementation.
 */

import type { Physics3DVec3, PathWaypoint3D } from "../types";
import type { PluginContext } from "./plugin-context";
import { uncheckedAt } from "../internal/unchecked";

// ─── MinHeap ───────────────────────────────────────────────────────────────────

/**
 * A generic binary min-heap for A* open sets.
 *
 * push and pop are both O(log n).
 *
 * @typeParam T - The value type stored alongside each priority.
 * @example
 * ```typescript
 * const heap = new MinHeap<string>();
 * heap.push('b', 10);
 * heap.push('a', 5);
 * heap.pop(); // 'a'
 * ```
 */
class MinHeap<T> {
  private readonly _data: Array<{ priority: number; value: T }> = [];

  /** Number of elements in the heap. */
  get size(): number {
    return this._data.length;
  }

  /**
   * Insert `value` with the given `priority`. O(log n).
   * @param value    - The value to store.
   * @param priority - Lower values are popped first.
   */
  push(value: T, priority: number): void {
    this._data.push({ priority, value });
    this._bubbleUp(this._data.length - 1);
  }

  /**
   * Remove and return the minimum-priority value. O(log n).
   * Returns `undefined` if the heap is empty.
   */
  pop(): T | undefined {
    if (this._data.length === 0) return undefined;
    const top = uncheckedAt(this._data, 0).value;
    const last = this._data.pop();
    if (last !== undefined && this._data.length > 0) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    const data = this._data;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentNode = uncheckedAt(data, parent);
      const node = uncheckedAt(data, i);
      if (parentNode.priority <= node.priority) break;
      data[parent] = node;
      data[i] = parentNode;
      i = parent;
    }
  }

  private _siftDown(i: number): void {
    const data = this._data;
    const n = data.length;
    while (true) {
      const node = uncheckedAt(data, i);
      let min = i;
      let minNode = node;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n) {
        const left = uncheckedAt(data, l);
        if (left.priority < minNode.priority) {
          min = l;
          minNode = left;
        }
      }
      if (r < n) {
        const right = uncheckedAt(data, r);
        if (right.priority < minNode.priority) {
          min = r;
          minNode = right;
        }
      }
      if (min === i) break;
      data[i] = minNode;
      data[min] = node;
      i = min;
    }
  }
}

// ─── Local A* pathfinding ──────────────────────────────────────────────────────

/**
 * Local-mode 3D A* pathfinding on the uploaded voxel grid.
 *
 * Converts world-space `from`/`to` positions to grid cells, runs A* with a
 * 6-connected neighbourhood and Manhattan-3D heuristic, then converts the
 * resulting cell path back to world-space waypoints.
 *
 * Falls back to a two-point path when no grid is available or when A* cannot
 * find a route within the iteration budget.
 */
export function localFindPath3D(
  ctx: PluginContext,
  from: Physics3DVec3,
  to: Physics3DVec3,
): PathWaypoint3D[] {
  if (!ctx._localNavGrid) {
    if (__GWEN_DEV__) {
      ctx.log.warn("findPath3D(): no nav grid uploaded — call initNavGrid3D() first");
    }
    return [{ x: to.x, y: to.y, z: to.z }];
  }

  const { grid, width, height, depth, cellSize } = ctx._localNavGrid;
  const ox = ctx._localNavGrid.origin?.x ?? 0;
  const oy = ctx._localNavGrid.origin?.y ?? 0;
  const oz = ctx._localNavGrid.origin?.z ?? 0;

  /** Convert world position to nearest grid cell (clamped to bounds). */
  const worldToCell = (wx: number, wy: number, wz: number): [number, number, number] => [
    Math.max(0, Math.min(width - 1, Math.round((wx - ox) / cellSize))),
    Math.max(0, Math.min(height - 1, Math.round((wy - oy) / cellSize))),
    Math.max(0, Math.min(depth - 1, Math.round((wz - oz) / cellSize))),
  ];

  /** Convert a grid cell back to world-space centre. */
  const cellToWorld = (cx: number, cy: number, cz: number): PathWaypoint3D => ({
    x: ox + cx * cellSize,
    y: oy + cy * cellSize,
    z: oz + cz * cellSize,
  });

  /** Returns true when cell is within bounds and walkable (grid value === 0). */
  const isWalkable = (cx: number, cy: number, cz: number): boolean => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= width || cy >= height || cz >= depth) return false;
    return grid[cx + cy * width + cz * width * height] === 0;
  };

  const [sx, sy, sz] = worldToCell(from.x, from.y, from.z);
  const [gx, gy, gz] = worldToCell(to.x, to.y, to.z);
  const goalKey = `${gx},${gy},${gz}`;

  type CellKey = string;
  const gScore = new Map<CellKey, number>();
  const cameFrom = new Map<CellKey, CellKey>();
  type OpenEntry = { key: CellKey; cx: number; cy: number; cz: number };
  const heap = new MinHeap<OpenEntry>();
  const closed = new Set<CellKey>();

  const startKey = `${sx},${sy},${sz}`;
  gScore.set(startKey, 0);
  const h0 = Math.abs(sx - gx) + Math.abs(sy - gy) + Math.abs(sz - gz);
  heap.push({ key: startKey, cx: sx, cy: sy, cz: sz }, h0);

  const MAX_ITER = 4096;
  let found = false;

  for (let iter = 0; iter < MAX_ITER && heap.size > 0; iter++) {
    const cur = heap.pop();
    if (cur === undefined) break;
    // Skip stale entries (node was already settled with a better path)
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);

    if (cur.key === goalKey) {
      found = true;
      break;
    }

    // 6-connected neighbourhood
    const nb6: [number, number, number][] = [
      [cur.cx + 1, cur.cy, cur.cz],
      [cur.cx - 1, cur.cy, cur.cz],
      [cur.cx, cur.cy + 1, cur.cz],
      [cur.cx, cur.cy - 1, cur.cz],
      [cur.cx, cur.cy, cur.cz + 1],
      [cur.cx, cur.cy, cur.cz - 1],
    ];
    const curG = gScore.get(cur.key) ?? 0;

    for (const [nx, ny, nz] of nb6) {
      if (!isWalkable(nx, ny, nz)) continue;
      const nk = `${nx},${ny},${nz}`;
      if (closed.has(nk)) continue;
      const tentG = curG + 1;
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentG);
        cameFrom.set(nk, cur.key);
        const h = Math.abs(nx - gx) + Math.abs(ny - gy) + Math.abs(nz - gz);
        heap.push({ key: nk, cx: nx, cy: ny, cz: nz }, tentG + h);
      }
    }
  }

  if (!found) {
    // No path found — return direct two-point fallback
    return [cellToWorld(sx, sy, sz), cellToWorld(gx, gy, gz)];
  }

  // Reconstruct path by walking back through cameFrom
  const path: PathWaypoint3D[] = [];
  let cur: CellKey | undefined = goalKey;
  while (cur !== undefined) {
    const parts = cur.split(",");
    path.unshift(cellToWorld(Number(parts[0]), Number(parts[1]), Number(parts[2])));
    cur = cameFrom.get(cur);
  }
  return path;
}

/** Caller-owned sample. The helper writes these fields and allocates nothing. */
export interface InterpolatedTransform2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** The last two committed 2D history buffers. */
export interface TransformPair2D {
  readonly previous: Float32Array;
  readonly current: Float32Array;
  readonly previousFlags: Uint32Array;
  readonly currentFlags: Uint32Array;
}

/** Stub: the read is not implemented. `out` stays untouched. */
export function readInterpolatedTransform2D(
  pair: TransformPair2D,
  slot: number,
  alpha: number,
  out: InterpolatedTransform2D,
): boolean {
  void pair;
  void slot;
  void alpha;
  void out;
  return false;
}

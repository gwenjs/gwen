/**
 * Reads `array[index]` where the caller already proved the index is in range.
 *
 * `noUncheckedIndexedAccess` types every indexed read as `T | undefined`. A non-null assertion
 * would hide the proof and a new branch would add work to a per-frame read. This plain function
 * inlines to the read itself: no branch, no allocation. It is not exported from the package entry.
 *
 * @param array - Array or typed array holding `index`.
 * @param index - Index in `[0, array.length)`.
 * @returns The element at `index`, typed without `undefined`.
 * @internal
 */
export function uncheckedAt<T>(array: ArrayLike<T>, index: number): T {
  return array[index] as T; // boundary: the caller's length check proves the index is in range
}

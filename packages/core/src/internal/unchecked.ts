/**
 * Reads `array[index]` where the caller's loop bound already proves the index is in range.
 *
 * `noUncheckedIndexedAccess` types every indexed read as `T | undefined`. In a hot loop the
 * guard `i < array.length` is the proof, and a non-null assertion or a new branch would hide
 * or add work. This plain function inlines to the read itself: no branch, no allocation.
 * It is not exported from the package entry.
 *
 * @param array - Array or typed array being walked.
 * @param index - Index in `[0, array.length)`.
 * @returns The element at `index`, typed without `undefined`.
 * @internal
 */
export function uncheckedAt<T>(array: ArrayLike<T>, index: number): T {
  return array[index] as T; // boundary: index proven in range by the loop bound
}

/**
 * Removes and returns the last element of an array the caller knows is not empty.
 *
 * Same contract as {@link uncheckedAt}: a plain inlinable function, no branch, no allocation.
 *
 * @param array - Array holding at least one element.
 * @returns The removed element, typed without `undefined`.
 * @internal
 */
export function popUnchecked<T>(array: T[]): T {
  return array.pop() as T; // boundary: caller proved the array is not empty
}

/**
 * Reads `map.get(key)` for a key the caller already proved present.
 *
 * @param map - Map holding `key`.
 * @param key - Key checked with `map.has(key)` by the caller.
 * @returns The stored value, typed without `undefined`.
 * @internal
 */
export function getUnchecked<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  return map.get(key) as V; // boundary: caller proved the key is present
}

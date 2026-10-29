export type DeepPartialInput<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartialInput<T[K]> | null }
      : T;

/** True for plain objects and prototype-less records. Arrays are not records. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Plain records stay as they are. Other objects are copied into a string-keyed record. */
export function recordOf(value: object): Record<string, unknown> {
  return isPlainRecord(value) ? value : Object.fromEntries(Object.entries(value));
}

/** Merge `high` over `low`. Plain objects merge deeply. Arrays replace. `undefined` is unset. `null` is a value. */
export function mergeLayers<T>(low: T, high: DeepPartialInput<T>): T {
  return mergeValue(low, high) as T;
}

function mergeValue(low: unknown, high: unknown): unknown {
  if (high === undefined) return low;
  if (!isPlainRecord(high)) return high;
  const base: Record<string, unknown> = isPlainRecord(low) ? { ...low } : {};
  for (const key of Object.keys(high)) {
    const highVal = high[key];
    if (highVal === undefined) continue;
    base[key] = mergeValue(base[key], highVal);
  }
  return base;
}

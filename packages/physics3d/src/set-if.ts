/**
 * Assign `value` only when it is present.
 * Keeps the key off the object, which `exactOptionalPropertyTypes` requires.
 */
export function setIf<T>(assign: (value: T) => void, value: T | undefined): void {
  if (value !== undefined) assign(value);
}

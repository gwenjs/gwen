/**
 * Shared helper types that stay in the schema.
 *
 * @module @gwenjs/schema
 */

/**
 * Generic hook handler function used across schema contracts.
 */
export type GwenHookHandler = (...args: readonly unknown[]) => unknown;

/**
 * Deep partial version of a type - all properties are recursively optional.
 *
 * @internal Used for type-safe partial config objects
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

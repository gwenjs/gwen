/**
 * @file Typed error for invalid engine configuration.
 */

import { GwenError } from "@gwenjs/schema";
import { CoreErrorCodes } from "./engine-errors.js";

/**
 * Thrown by {@link validateEngineConfig} when a config value is invalid or
 * out of the accepted range.
 *
 * @example
 * ```ts
 * try {
 *   const engine = await createEngine({ maxEntities: -1 });
 * } catch (e) {
 *   if (e instanceof GwenConfigError) {
 *     console.error(`Bad config: ${e.field} = ${e.value}. Hint: ${e.hint}`);
 *   }
 * }
 * ```
 */
export class GwenConfigError extends GwenError {
  /** The name of the invalid config field (e.g. `'maxEntities'`). */
  readonly field: string;
  /** The value that was rejected. */
  readonly value: unknown;

  constructor(field: string, value: unknown, options?: { hint?: string | undefined }) {
    super(CoreErrorCodes.INVALID_CONFIG, `Invalid config "${field}": ${String(value)}.`, {
      composable: "createEngine",
      hint: __GWEN_DEV__ ? options?.hint : undefined,
    });
    this.name = "GwenConfigError";
    this.field = field;
    this.value = value;
  }
}

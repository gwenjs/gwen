/**
 * @file Typed error for invalid engine configuration.
 */

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
 *
 * @since 1.0.0
 */
export class GwenConfigError extends Error {
  /** The name of the invalid config field (e.g. `'maxEntities'`). */
  readonly field: string;
  /** The value that was rejected. */
  readonly value: unknown;
  /**
   * Developer-friendly suggestion for fixing the issue.
   * @example "Try 10_000 for a typical game."
   */
  readonly hint: string;

  constructor(field: string, value: unknown, hint: string) {
    super(`[GWEN] Invalid config — "${field}": ${String(value)}. ${hint}`);
    Object.setPrototypeOf(this, GwenConfigError.prototype);
    this.name = 'GwenConfigError';
    this.field = field;
    this.value = value;
    this.hint = hint;
  }
}

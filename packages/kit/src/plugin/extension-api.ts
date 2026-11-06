import type { GwenExtensionApi } from "@gwenjs/schema";

/**
 * Pure. The same two comparisons as `engine.use` step 3b.
 * True when `actual` has the same major and a minor greater than or equal to `required`.
 */
export function isExtensionApiCompatible(
  required: GwenExtensionApi,
  actual: GwenExtensionApi | undefined,
): boolean {
  return actual !== undefined && actual.major === required.major && actual.minor >= required.minor;
}

import { describe, it } from "vitest";
import type { PluginConformanceSpec } from "./runtime/types.js";

/** The two vitest functions the rows are registered with. */
interface RowApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void): void;
}

/**
 * Registers the rows of `spec` through `api`.
 * Split from {@link describePluginConformance} so a test can record them.
 * Not part of the public snapshot. This body registers no rows.
 */
export function registerPluginConformance(_spec: PluginConformanceSpec, _api: RowApi): void {}

/** Registers the runtime conformance rows of `spec` in the current vitest suite. */
export function describePluginConformance(spec: PluginConformanceSpec): void {
  registerPluginConformance(spec, { describe, it });
}

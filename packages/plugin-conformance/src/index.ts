/** Static conformance checks for a GWEN plugin or package. */
export { checkPluginPackage } from "./check-plugin-package.js";
export { ConformanceErrorCodes } from "./error-codes.js";
export { FRAMEWORK_ENTRIES } from "./framework-entries.generated.js";
export { runComposableSurfaceSuite } from "./run-composable-surface-suite.js";
export { checkSnapshot } from "./snapshot.js";
export type { ComposableSurfaceOptions } from "./run-composable-surface-suite.js";
export type {
  CheckPluginPackageOptions,
  ConformanceCheckId,
  ConformanceCode,
  ConformanceFinding,
  ConformanceReport,
} from "./types.js";

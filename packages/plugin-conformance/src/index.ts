/** Static conformance checks for a GWEN plugin or package. */
export { checkPluginPackage } from "./check-plugin-package.js";
export { ConformanceErrorCodes } from "./error-codes.js";
export { checkSnapshot } from "./snapshot.js";
export type {
  CheckPluginPackageOptions,
  ConformanceCheckId,
  ConformanceCode,
  ConformanceFinding,
  ConformanceReport,
} from "./types.js";

import type { ConformanceCheckId } from "./check-ids.js";
import type { ConformanceErrorCodes } from "./error-codes.js";

export type { ConformanceCheckId };

/** Code string raised by an implemented conformance check. */
export type ConformanceCode = (typeof ConformanceErrorCodes)[keyof typeof ConformanceErrorCodes];

/** One problem found in a package, with a fix hint. */
export interface ConformanceFinding {
  readonly code: ConformanceCode;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly hint: string;
}

/** Checks that ran, then the findings they produced. */
export interface ConformanceReport {
  readonly checks: readonly ConformanceCheckId[];
  readonly findings: readonly ConformanceFinding[];
}

/** Input for {@link checkPluginPackage}. `root` is the package directory. */
export interface CheckPluginPackageOptions {
  readonly root: string;
  /** `plugin` requires `.` and `./module`. `package` does not. */
  readonly profile: "plugin" | "package";
  /** Accepted, not used yet (PC-1a2b). */
  readonly write?: boolean;
  /** Accepted, not used yet (PC-1c). */
  readonly lockfileBase?: string;
}

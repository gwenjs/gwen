import type { ConformanceErrorCodes } from "./error-codes.js";

export type ConformanceCode = (typeof ConformanceErrorCodes)[keyof typeof ConformanceErrorCodes];

export type ConformanceCheckId =
  | "exports"
  | "snapshot-values"
  | "snapshot-types"
  | "publint"
  | "attw"
  | "readme"
  | "imports"
  | "augment"
  | "hooks"
  | "test-mocks"
  | "peers"
  | "manifest"
  | "lockfile";

export interface ConformanceFinding {
  readonly code: ConformanceCode;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly hint: string;
}

export interface ConformanceReport {
  readonly checks: readonly ConformanceCheckId[];
  readonly findings: readonly ConformanceFinding[];
}

export interface CheckPluginPackageOptions {
  readonly root: string;
  readonly profile: "plugin" | "package";
  readonly write?: boolean;
  readonly lockfileBase?: string;
}

import type { GwenEngine } from "@gwenjs/core";
import type { GwenPlugin } from "@gwenjs/schema";
import type { ConformanceFinding } from "../types.js";

/** Ids of the runtime checks, in check order. Not part of the static check list. */
export type RuntimeCheckId =
  | "shape"
  | "requires"
  | "provides"
  | "frames"
  | "remove"
  | "reentry"
  | "two-engines"
  | "stop"
  | "options"
  | "module"
  | "hooks"
  | "composable";

/** One factory loaded from the built root entry. */
export interface PluginFactorySpec {
  /** Export name of the factory. */
  readonly export: string;
  readonly options?: unknown;
  readonly invalidOptions?: unknown;
}

/**
 * Input of {@link runPluginConformance}.
 * `root`, when absent, is the process working directory.
 * `official`, when absent, follows `packageName` starting with `@gwenjs/`.
 */
export interface PluginConformanceSpec {
  readonly packageName: string;
  /** At least one factory. */
  readonly factories: readonly PluginFactorySpec[];
  readonly root?: string;
  readonly official?: boolean;
  readonly frameworkProviders?: readonly (() => GwenPlugin)[];
  /** Runs before the first advance. The argument is the core engine. */
  readonly fixture?: (engine: GwenEngine) => void | Promise<void>;
  /** How many frames to advance. Default 3, minimum 1. */
  readonly frames?: number;
  readonly variant?: "light" | "physics2d" | "physics3d";
}

/** Checks that ran, then the findings they produced. */
export interface RuntimeConformanceReport {
  readonly checks: readonly RuntimeCheckId[];
  readonly findings: readonly ConformanceFinding[];
}

/** A loaded spec. Not part of the public runtime entry. */
export interface RuntimeCheckContext {
  readonly spec: PluginConformanceSpec;
  readonly entry: Record<string, unknown>;
}

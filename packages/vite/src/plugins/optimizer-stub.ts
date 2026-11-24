import type { Plugin } from "vite";
import { GwenError } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import type { WasmTier } from "../types.js";

/**
 * Options for `gwenOptimizerPlugin`.
 * Kept for type compatibility; gwenOptimizerPlugin throws.
 */
export interface GwenOptimizerOptions {
  /** Accepted and ignored. */
  debug?: boolean;
  /** Accepted and ignored. */
  mode?: "detect" | "transform";
  /** Accepted and ignored. */
  tier?: WasmTier;
  /** Accepted and ignored. */
  componentsDir?: string;
}

/**
 * Removed. Throws.
 */
export function gwenOptimizerPlugin(_options: GwenOptimizerOptions = {}): Plugin {
  throw new GwenError(
    ViteErrorCodes.TRANSFORM_UNSUPPORTED,
    "gwenOptimizerPlugin was removed; use the optimizer option.",
    { composable: "gwenOptimizerPlugin" },
  );
}

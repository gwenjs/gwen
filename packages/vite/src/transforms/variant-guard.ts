/**
 * `gwen:variant-guard` stub: no package is in the table and the unit never raises.
 */

import type { GwenEngineConfig } from "@gwenjs/schema";
import type { GwenSourceTransform } from "../pipeline/types.js";

export interface VariantGuardOptions {
  readonly root: string;
  readonly variant: GwenEngineConfig["variant"];
  readonly declaredModules: readonly string[];
}

export const VARIANT_PACKAGES: Readonly<Record<string, GwenEngineConfig["variant"]>> = {};

export function variantOfPackage(_spec: string): GwenEngineConfig["variant"] | null {
  return null;
}

export function createVariantGuard(_options: VariantGuardOptions): GwenSourceTransform {
  return {
    name: "gwen:variant-guard",
    run() {
      return [];
    },
  };
}

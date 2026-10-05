import type { ResolvedConfig } from "vite";

/** Vite's `import.meta.env.DEV`. A resolved config always sets this boolean. */
export function devFromResolvedConfig(config: Pick<ResolvedConfig, "env">): boolean {
  return config.env.DEV;
}

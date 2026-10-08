import type { ResolvedConfig } from "vite";

/**
 * The GWEN dev flag for this Vite run.
 *
 * - Build: follows the Vite mode. `vite build` (mode `production`) gives `false`;
 *   `vite build --mode development` gives `true`. NODE_ENV is not read: Vite
 *   forces `NODE_ENV=production` on build, so `import.meta.env.DEV` stays `false`
 *   for `--mode development` (vite.dev/guide/env-and-mode, "NODE_ENV and Modes").
 * - Serve and preview: Vite's `import.meta.env.DEV` (`vite` / `vite dev` give `true`).
 */
export function devFromResolvedConfig(
  config: Pick<ResolvedConfig, "env" | "command" | "mode">,
): boolean {
  if (config.command === "build") return config.mode === "development";
  return config.env.DEV;
}

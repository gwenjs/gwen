import type { Plugin } from "vite";
import type { GwenViteOptions } from "../types.js";
import { scanEasingNames } from "../scanners/index.js";

/**
 * Options for the `gwen:tween` sub-plugin.
 *
 * @since 1.0.0
 */
export interface GwenTweenOptions {
  /**
   * Disable easing tree-shake analysis.
   * When `true`, no source file is scanned and the virtual module
   * `virtual:gwen/used-easings` exports an empty list
   * (`packages/vite/src/plugins/tween.ts:75-77`, test
   * `packages/vite/tests/tween-plugin.test.ts:96-103`).
   *
   * @default false
   * @since 1.0.0
   */
  disableEasingAnalysis?: boolean;
}

/** Virtual module ID exposed to the user's code. */
const VIRTUAL_ID = "virtual:gwen/used-easings";

/** Resolved internal module ID (prefixed with `\0` per Vite convention). */
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/**
 * GWEN sub-plugin for easing tree-shake analysis.
 *
 * Scans `src/**` under the project root, when the virtual module loads, for
 * `useTween()` calls and detects which `EasingName` string literals are used
 * as static values on the `easing:` property of an object argument.
 * A file that cannot be read or parsed fails the build.
 * It exposes a virtual module `virtual:gwen/used-easings` that exports only the detected
 * easing names so bundlers can tree-shake the rest.
 *
 * **Virtual module usage:**
 * ```ts
 * import { usedEasings } from 'virtual:gwen/used-easings'
 * // e.g. ['linear', 'easeOutQuad']
 * ```
 *
 * @param options - Top-level GWEN Vite plugin options.
 * @returns Vite plugin instance.
 *
 * @since 1.0.0
 */
export function gwenTweenPlugin(options: GwenViteOptions = {}): Plugin {
  const disableEasingAnalysis = options.tween?.disableEasingAnalysis ?? false;

  let root = process.cwd();

  /** Easing names found by the last scan, for the `buildEnd` log. */
  let detected: readonly string[] = [];

  return {
    name: "gwen:tween",

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      detected = disableEasingAnalysis
        ? []
        : scanEasingNames(root, { autoImports: options.autoImports ?? [] });
      return `export const usedEasings = ${JSON.stringify(detected)};\n`;
    },

    buildEnd() {
      if (this.environment?.mode === "dev" || process.env["NODE_ENV"] === "development") {
        const names = detected.join(", ") || "(none)";
        // eslint-disable-next-line no-console
        console.info(`[gwen:tween] Detected ${detected.length} easing(s): ${names}`);
      }
    },
  };
}

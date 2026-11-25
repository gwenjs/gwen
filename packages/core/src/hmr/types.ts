/**
 * @file Hot-reload report types shared by every `hotReplace*` function.
 *
 * Dev only. They live in `@gwenjs/core/internal`: the Vite runtime maps a report to its
 * own codes, and plugin authors never read them.
 *
 * @module
 */

/** What kind of definition a hot replacement targeted. */
export type GwenHotKind = "system" | "actor" | "scene" | "layout" | "component" | "plugin";

/**
 * Why a definition could not be swapped in place and the page has to reload.
 *
 * - `engine-not-running`: the engine is not `idle` or `running`.
 * - `component-layout-changed`: the component name or its field layout differs.
 * - `scene-set-changed`: the set of scenes differs.
 * - `router-changed`: the scene router differs.
 * - `plugin-in-use`: another plugin still depends on the plugin being replaced.
 */
export type GwenHotReloadReason =
  | "engine-not-running"
  | "component-layout-changed"
  | "scene-set-changed"
  | "router-changed"
  | "plugin-in-use";

/**
 * Outcome of one hot replacement.
 *
 * `applied` carries the number of installs that now run the new definition. Zero means nothing
 * was installed, so nothing changed. `reload` asks the caller to reload the page and says why;
 * `detail` names the first difference when there is one.
 */
export type GwenHotReport =
  | {
      readonly status: "applied";
      readonly kind: GwenHotKind;
      readonly name: string;
      readonly count: number;
    }
  | {
      readonly status: "reload";
      readonly kind: GwenHotKind;
      readonly name: string;
      readonly reason: GwenHotReloadReason;
      readonly detail?: string;
    };

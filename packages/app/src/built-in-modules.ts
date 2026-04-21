/**
 * @file Built-in GWEN modules — loaded first in setupModules()
 *
 * These modules are loaded before user modules and follow the same
 * code path: `mod.meta.configKey` maps to the corresponding key in `gwen.config.ts`.
 *
 * Order is guaranteed — each module can depend on the previous ones.
 */

import type { GwenModule } from "@gwenjs/schema";
import SystemModule from "@gwenjs/core/system/module";
import ActorModule from "@gwenjs/core/actor/module";
import SceneModule from "@gwenjs/core/scene/module";
import RouterModule from "@gwenjs/core/router/module";
import TweenModule from "@gwenjs/core/tween/module";

/**
 * Built-in modules loaded before user modules in `setupModules()`.
 * Order is guaranteed — each module can depend on the previous ones.
 *
 * Processed through the same code path as user modules:
 * `mod.meta.configKey` maps to the corresponding key in `gwen.config.ts`.
 */
export const BUILT_IN_MODULES: GwenModule[] = [
  SystemModule,
  ActorModule,
  SceneModule,
  RouterModule,
  TweenModule,
];

/* oxlint-disable no-unused-vars -- type fixture: the checker is the assertion */

import type * as Root from "@gwenjs/vite";

type _0 = [
  Root.ActorPluginOptions,
  Root.CoreVariant,
  Root.GwenOptimizerOptions,
  Root.GwenPhysics3DOptimizerOptions,
  Root.GwenPluginOptions,
  Root.GwenTransformOptions,
  Root.GwenViteOptions,
  Root.GwenWasmOptions,
  Root.WasmVariant,
];

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { generateEntryModule } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { generateScenesModule } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { generateConfigModulesVirtualModule } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { extractModuleNamesFromConfig } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { extractGlobalCssFromConfig } from "@gwenjs/vite";

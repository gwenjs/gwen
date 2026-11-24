/* oxlint-disable no-unused-vars -- type fixture: the checker is the assertion */

import type * as Root from "@gwenjs/vite";

type _0 = [
  Root.ActorPluginOptions,
  Root.CoreVariant,
  Root.GwenPhysics3DOptimizerOptions,
  Root.GwenPluginOptions,
  Root.GwenViteOptions,
];

type Physics3DOptimizerMode = NonNullable<Root.GwenPhysics3DOptimizerOptions["mode"]>;

const _transformIsNotAPhysics3DOptimizerMode: "transform" extends Physics3DOptimizerMode
  ? never
  : true = true;

const _warnIsAPhysics3DOptimizerMode: "warn" extends Physics3DOptimizerMode ? true : never = true;

const _omittedPhysics3DOptimizerOptions: Root.GwenPhysics3DOptimizerOptions = {};

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { generateEntryModule } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { generateScenesModule } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { extractModuleNamesFromConfig } from "@gwenjs/vite";

// @ts-expect-error TS2305 — removed from @gwenjs/vite
import { extractGlobalCssFromConfig } from "@gwenjs/vite";

const _noGwenOptimizerPlugin: "gwenOptimizerPlugin" extends keyof typeof Root ? false : true = true;

const _noGwenTransform: "gwenTransform" extends keyof typeof Root ? false : true = true;

const _gwenAcceptsOptimizer: Root.GwenPluginOptions = { optimizer: { debug: true } };

const _noComponentsDir: "componentsDir" extends keyof Exclude<
  NonNullable<Root.GwenViteOptions["optimizer"]>,
  boolean
>
  ? false
  : true = true;

const _noTier: "tier" extends keyof Exclude<NonNullable<Root.GwenViteOptions["optimizer"]>, boolean>
  ? false
  : true = true;

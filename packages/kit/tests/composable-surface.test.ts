/**
 * @file Composable surface of the main entry of @gwenjs/kit (#75, P-75-4).
 *
 * Every `use*` and `on*` function export must throw `GwenContextError` outside a
 * context, and every other function export must follow a prefix rule or sit in
 * the allow record below, each with its reason.
 */

import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import * as kit from "../src/index";
import * as kitPlugin from "../src/plugin/index";

const ALLOW: Readonly<Record<string, string>> = {
  _setCurrentScope: "marked @internal, engine use only (scope-slot.ts)",
  tryUseEngine: "never throws: returns undefined where useEngine throws (engine-slot.ts)",
  optionalService: "live read of a service, undefined when absent (plugin/watch-service.ts)",
  satisfiesPluginContract: "compile-time check that returns its plugin, not a composable",
  unpackEntityId: "pure helper, inverse of createEntityId",
  watchService: "subscribes inside setup and returns a dispose function (plugin/watch-service.ts)",
};

runComposableSurfaceSuite({ ...kit, ...kitPlugin }, { allow: Object.keys(ALLOW) });

/**
 * @file Composable surface of the main entry of @gwenjs/physics2d (#75, P-75-4).
 *
 * Every `use*` and `on*` function export must throw `GwenContextError` outside a
 * context, and every other function export must follow a prefix rule or sit in
 * the allow record below, each with its reason.
 */

import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import * as physics2d from "../src/index";

const ALLOW: Readonly<Record<string, string>> = {
  Physics2DPlugin: "plugin factory, named after the plugin",
  buildTilemapPhysicsChunks: "helper function, not a composable",
  patchTilemapPhysicsChunk: "helper function, not a composable",
  physics2dVitePlugin: "Vite plugin factory, runs at build time",
};

runComposableSurfaceSuite(physics2d, { allow: Object.keys(ALLOW) });

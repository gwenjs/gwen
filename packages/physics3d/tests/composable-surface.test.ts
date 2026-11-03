/**
 * @file Composable surface of the main entry of @gwenjs/physics3d (#75, P-75-4).
 *
 * Every `use*` and `on*` function export must throw `GwenContextError` outside a
 * context, and every other function export must follow a prefix rule or sit in
 * the allow record below, each with its reason.
 */

import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import * as physics3d from "../src/index";

const ALLOW: Readonly<Record<string, string>> = {
  Physics3DPlugin: "plugin factory, named after the plugin",
  default: "default export, an alias of Physics3DPlugin",
  applyDirectionalImpulse: "helper function, not a composable",
  dedupeContactsByPair: "helper function, not a composable",
  isSensorActive: "helper function, not a composable",
  moveKinematicByVelocity: "helper function, not a composable",
  physics3dVitePlugin: "Vite plugin factory, runs at build time",
  preloadMeshCollider: "takes a url and returns a preload handle, not a composable",
  selectContactsForEntityId: "helper function, not a composable",
  selectResolvedContactsForEntityId: "helper function, not a composable",
};

runComposableSurfaceSuite(physics3d, { allow: Object.keys(ALLOW) });

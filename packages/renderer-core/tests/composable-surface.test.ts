/**
 * @file Composable surface of the main entry of @gwenjs/renderer-core (#75, P-75-4).
 *
 * Every `use*` and `on*` function export must throw `GwenContextError` outside a
 * context, and every other function export must follow a prefix rule or sit in
 * the allow record below, each with its reason.
 */

import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import * as rendererCore from "../src/index";

const ALLOW: Readonly<Record<string, string>> = {
  BrowserSizeProvider: "size provider factory, named after the provider",
  ScreenPlugin: "plugin factory, named after the plugin",
  StaticSizeProvider: "size provider factory, named after the provider",
  writeCameraViews: "takes the engine as its first argument, not a composable",
};

runComposableSurfaceSuite(rendererCore, { allow: Object.keys(ALLOW) });

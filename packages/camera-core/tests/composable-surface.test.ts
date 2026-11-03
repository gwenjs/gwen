/**
 * @file Composable surface of the main entry of @gwenjs/camera-core (#75, P-75-4).
 *
 * Every `use*` and `on*` function export must throw `GwenContextError` outside a
 * context, and every other function export must follow a prefix rule or sit in
 * the allow record below, each with its reason.
 */

import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import * as cameraCore from "../src/index";

const ALLOW: Readonly<Record<string, string>> = {
  CameraCorePlugin: "plugin factory, named after the plugin",
  CameraSystem: "system factory, named after the system",
  clearCameraPath: "engine verb: takes the engine as its first argument, not a composable",
  setCameraPath: "engine verb: takes the engine as its first argument, not a composable",
  setCameraViewport: "engine verb: takes the engine as its first argument, not a composable",
};

runComposableSurfaceSuite(cameraCore, { allow: Object.keys(ALLOW) });

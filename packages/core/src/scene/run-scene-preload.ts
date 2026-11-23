/**
 * @file Stub. Does not run `scene:preload` or emit progress.
 */

import type { GwenSceneName } from "@gwenjs/schema";
import type { GwenEngine } from "../engine/engine-types.js";

export async function runScenePreload(
  _engine: GwenEngine,
  _from: GwenSceneName | null,
  _to: GwenSceneName,
): Promise<void> {}

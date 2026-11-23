/**
 * @file Typed error for a rejected scene preload.
 */

import { GwenError, type GwenSceneName } from "@gwenjs/schema";
import { CoreErrorCodes } from "../engine/engine-errors.js";

/**
 * Thrown when a `scene:preload` handler rejects.
 *
 * The transition is cancelled. `cause` is that rejection, kept by identity.
 * A route change names `useSceneRouter().send`. The first scene does not.
 */
export class GwenScenePreloadError extends GwenError {
  /** Machine-readable code `CORE:SCENE_PRELOAD_FAILED`. */
  override readonly code: typeof CoreErrorCodes.SCENE_PRELOAD_FAILED;

  /** Scene whose preload rejected. */
  readonly scene: GwenSceneName;

  /** Scene being left, or `null` when the first scene could not be activated. */
  readonly from: GwenSceneName | null;

  /**
   * @param init.scene Scene that failed to preload.
   * @param init.from Previous scene, or `null` for the first scene.
   * @param init.cause Handler rejection, forwarded by identity.
   */
  constructor(init: { scene: GwenSceneName; from: GwenSceneName | null; cause: unknown }) {
    const scene = init.scene;
    const from = init.from;
    super(CoreErrorCodes.SCENE_PRELOAD_FAILED, `Preload of scene "${scene}" failed.`, {
      ...(from !== null ? { composable: "useSceneRouter().send" } : {}),
      hint: __GWEN_DEV__
        ? from !== null
          ? "Handle the error inside onPreload or keep the previous scene; the transition was cancelled."
          : "Handle the error inside onPreload of the main scene; the first scene could not be activated."
        : undefined,
      cause: init.cause,
    });
    this.name = "GwenScenePreloadError";
    this.code = CoreErrorCodes.SCENE_PRELOAD_FAILED;
    this.scene = scene;
    this.from = from;
  }
}

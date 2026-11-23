import { GwenError, type GwenSceneName } from "@gwenjs/schema";

export class GwenScenePreloadError extends GwenError {
  declare readonly scene: GwenSceneName;
  declare readonly from: GwenSceneName | null;
  constructor(_init: { scene: GwenSceneName; from: GwenSceneName | null; cause: unknown }) {
    super("CORE:UNCAUGHT_ERROR", "stub");
  }
}

import type { Plugin } from "vite";
import type { GwenSourceTransform } from "./types.js";

/** In-plugin handle. `register` is refused after `configResolved`. */
export interface GwenTransformPipelineApi {
  register(t: GwenSourceTransform): void;
  readonly names: readonly string[];
}

/**
 * Naive stub. `transform` returns null and `register` keeps nothing,
 * so the pipeline tests compile and fail on their assertions.
 */
export function createTransformPipeline(_options: {
  units: GwenSourceTransform[];
}): Plugin & { api: GwenTransformPipelineApi } {
  const names: readonly string[] = [];
  const api: GwenTransformPipelineApi = {
    register(): void {},
    names,
  };
  return {
    name: "gwen:transform-pipeline",
    enforce: "pre",
    transform() {
      return null;
    },
    api,
  };
}

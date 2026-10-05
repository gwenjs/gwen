// Re-exported from src so `@gwenjs/core/testing` owns the helper.
// This path stays the integration-wasm entry and must not import vitest.
export {
  createRealEngine,
  type CreateRealEngineOptions,
  type RealEngineHandle,
} from "../../src/testing/create-real-engine.js";

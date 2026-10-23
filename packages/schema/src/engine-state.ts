/**
 * Lifecycle state of the core engine (`GwenEngine` in `@gwenjs/core`).
 * There is no `paused` state. `timeScale = 0` pauses simulation time.
 */
export type GwenEngineState = "idle" | "starting" | "running" | "stopping" | "stopped" | "faulted";

/** Why the core engine (`GwenEngine` in `@gwenjs/core`) moved from one {@link GwenEngineState} to another. */
export type GwenEngineStateChangeReason = "USER" | "WASM_PANIC" | "FATAL_ERROR";

/**
 * Payload of the `engine:state-change` hook.
 * Emitted once per real transition. A no-op does not emit.
 */
export interface EngineStateChangePayload {
  readonly from: GwenEngineState;
  readonly to: GwenEngineState;
  readonly reason: GwenEngineStateChangeReason;
}

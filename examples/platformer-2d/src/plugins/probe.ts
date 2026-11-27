import { useEngine, useHook } from "@gwenjs/core";
import type { EngineStateChangePayload, EntityId, GwenEngineState } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import { Position } from "../components/Position";

export interface ProbeError {
  readonly level: "error" | "fatal";
  readonly code: string;
  readonly message: string;
}

export interface ExampleProbeSnapshot {
  state: GwenEngineState;
  scene: string | null;
  frameCount: number;
  entityCount: number;
  errors: readonly ProbeError[];
  hasPhaseMs: boolean;
  coinsCollected: number;
  playerX: number;
  driftX: number;
  fps: number;
  rawFrameTimeMs: number;
}

/**
 * One page runs one engine. The scene registers these readers because the
 * probe is not an actor and cannot see the player handle itself.
 */
let readPlayerX = (): number => 0;
let drifterId: EntityId | undefined;

export function watchPlayer(read: () => number): void {
  readPlayerX = read;
}

export function watchDrifter(id: EntityId): void {
  drifterId = id;
}

export default definePlugin(() => {
  const off: (() => void)[] = [];
  return {
    name: "example:probe",
    setup() {
      const engine = useEngine();
      let state: GwenEngineState = "idle";
      let scene: string | null = null;
      const errors: ProbeError[] = [];
      let coinsCollected = 0;
      off.push(
        useHook("engine:state-change", (payload: EngineStateChangePayload) => {
          state = payload.to;
        }),
        useHook("engine:error", (payload) => {
          errors.push({ level: payload.level, code: payload.code, message: payload.message });
        }),
        useHook("scene:enter", (name) => {
          scene = name;
        }),
        useHook("game:coin-collected", () => {
          coinsCollected += 1;
        }),
      );
      window.__gwenProbe = {
        snapshot() {
          const stats = engine.getStats();
          const row =
            drifterId === undefined ? undefined : engine.getComponent(drifterId, Position);
          return {
            state,
            scene,
            frameCount: stats.frameCount,
            entityCount: stats.entityCount,
            errors: [...errors],
            hasPhaseMs: stats.phaseMs !== undefined,
            coinsCollected,
            playerX: readPlayerX(),
            driftX: row === undefined ? 0 : row.x,
            fps: stats.fps,
            rawFrameTimeMs: stats.rawFrameTime * 1000,
          };
        },
      };
      useHook("engine:stop", () => {
        for (const stop of off) stop();
        off.length = 0;
        delete window.__gwenProbe;
      });
    },
  };
});

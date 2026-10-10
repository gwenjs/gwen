import type { EngineFramePhaseMs, EngineStats } from "./engine-types.js";

/**
 * `targetFPS` and `debug` are the facade's readonly fields, copied once.
 * `entityCount` is `EngineEntities.count`, read when `snapshot` runs.
 * `linearMemory` is the bridge memory after the facade's function guard.
 * `phaseMs` is the facade's reused phase slot. The frame loop still writes it.
 */
export interface EngineStatsRecorderDeps {
  targetFPS: number;
  debug: boolean;
  entityCount: () => number;
  linearMemory: () => WebAssembly.Memory | null;
  phaseMs: () => EngineFramePhaseMs | undefined;
}

/**
 * Frame duration, smoothed fps, delta, and the stats snapshot for one engine.
 * @internal
 */
export class EngineStatsRecorder {
  private _deltaTime = 0;
  /** Completed frames. The loop calls {@link frameCompleted} once per finished `_runFrame`. */
  private _frameCount = 0;
  /** Smoothed FPS. First positive raw sample is exact; later samples use a 0.5s EMA. */
  private _fps = 0;
  /** True after the first positive raw frame sample. */
  private _hasFpsSample = false;
  /** Uncapped, unscaled wall-frame duration in seconds. */
  private _rawFrameTime = 0;

  constructor(private readonly deps: EngineStatsRecorderDeps) {}

  get deltaTime(): number {
    return this._deltaTime;
  }

  /** Uncapped, unscaled wall-frame duration in seconds. */
  get rawFrameTime(): number {
    return this._rawFrameTime;
  }

  /** Completed `_runFrame` calls. In fixed mode, one per simulation step. */
  get frameCount(): number {
    return this._frameCount;
  }

  /** Smoothed frames per second from the raw wall-frame duration. Ignores `timeScale`. */
  get fps(): number {
    return this._fps;
  }

  setDeltaTime(seconds: number): void {
    this._deltaTime = seconds;
  }

  recordRawFrameTime(rawSeconds: number): void {
    this._rawFrameTime = rawSeconds;
    if (!(rawSeconds > 0)) return;
    const sample = 1 / rawSeconds;
    if (!this._hasFpsSample) {
      this._fps = sample;
      this._hasFpsSample = true;
      return;
    }
    const alpha = 1 - Math.exp(-rawSeconds / 0.5);
    this._fps = alpha * sample + (1 - alpha) * this._fps;
  }

  frameCompleted(): void {
    this._frameCount++;
  }

  snapshot(): EngineStats {
    const budgetMs = 1000 / this.deps.targetFPS;
    const memory = this.deps.linearMemory();
    const stats: EngineStats = {
      fps: this._fps,
      rawFrameTime: this._rawFrameTime,
      deltaTime: this._deltaTime,
      frameCount: this._frameCount,
      entityCount: this.deps.entityCount(),
      budgetMs,
    };
    if (memory !== null) stats.wasmMemoryBytes = memory.buffer.byteLength;
    const showPhases = __GWEN_DEV__ && this.deps.debug;
    const phaseMs = this.deps.phaseMs();
    if (showPhases && phaseMs !== undefined) {
      stats.phaseMs = { ...phaseMs };
      stats.overBudget = phaseMs.total > budgetMs;
    }
    return stats;
  }
}

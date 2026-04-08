/** Minimal stub — full implementation in Task 4. */
export interface RendererStatsCollector {
  reportLayer(layerName: string, stats: Record<string, unknown>): void;
  reportFrameTime(ms: number): void;
}

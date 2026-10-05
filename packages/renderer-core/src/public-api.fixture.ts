/* oxlint-disable no-unused-vars -- type fixture: the checker is the assertion */

import type * as Root from "@gwenjs/renderer-core";
import type * as T_testing from "@gwenjs/renderer-core/testing";

type _0 = [
  Root.AnimOpts,
  Root.AnimatorHandle,
  Root.CameraManager,
  Root.CameraProjection,
  Root.CameraState,
  Root.HTMLHandle,
  Root.LayerDef,
  Root.ManagedRendererService,
  Root.MeshHandle,
  Root.RendererErrorCode,
  Root.RendererFlushContext,
  Root.RendererLayerStats,
  Root.RendererMountContext,
  Root.RendererRendererStats,
  Root.RendererService,
  Root.RendererServiceDef,
  Root.RendererServiceInstance,
  Root.RendererStats,
  Root.RendererStatsCollector,
  Root.ScreenErrorCode,
  Root.ScreenPluginOptions,
  Root.ScreenService,
  Root.ScreenSizeProvider,
  Root.SpriteHandle,
  Root.ViewportBounds,
  Root.ViewportBoundsProvider,
  Root.ViewportContext,
  Root.ViewportManager,
  Root.ViewportPixels,
  Root.ViewportRegion,
  Root.ViewportScreenInfo,
  Root.WorldTransform,
];
type _1 = [T_testing.MockSizeProviderHandle];

// @ts-expect-error TS2305 — removed from @gwenjs/renderer-core
import { CameraManagerImpl } from "@gwenjs/renderer-core";

// @ts-expect-error TS2305 — removed from @gwenjs/renderer-core
import { ViewportManagerImpl } from "@gwenjs/renderer-core";

// @ts-expect-error TS2305 — removed from @gwenjs/renderer-core
import { RendererStatsCollectorImpl } from "@gwenjs/renderer-core";

// @ts-expect-error TS2305 — removed from @gwenjs/renderer-core
import { createRendererStats } from "@gwenjs/renderer-core";

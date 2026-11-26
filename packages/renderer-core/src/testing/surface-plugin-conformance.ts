/**
 * @file Plugin-level conformance for a surface renderer plugin.
 *
 * `runSurfacePluginConformance` installs the plugin on the real render host
 * (`RenderHostPlugin` + `ScreenPlugin`) of real engines, counts the calls to `renderViews`
 * and checks mount, draw, resize, teardown, two engines and a late install.
 */

import type { GwenEngine } from "@gwenjs/core";
import type { RealEngineHandle } from "@gwenjs/core/testing";
import { GwenError } from "@gwenjs/schema";
import type { CameraState, GwenPlugin, GwenPluginServiceKey } from "@gwenjs/schema";
import { RendererErrorCodes } from "../errors.js";
import { RenderHostPlugin } from "../render-host-plugin.js";
import { ScreenPlugin } from "../screen-plugin.js";
import type { RenderView, SurfaceRendererService } from "../types.js";
import { MockSizeProvider } from "./mock-size-provider.js";
import type { MockSizeProviderHandle } from "./mock-size-provider.js";
import { thrownText } from "./thrown-text.js";

/** Options of {@link runSurfacePluginConformance}. */
export interface SurfacePluginConformanceOptions {
  /** Builds a new plugin on every call: the suite installs one per engine. */
  readonly plugin: () => GwenPlugin;
  /** Service key under which the plugin provides its `SurfaceRendererService`. */
  readonly serviceKey: GwenPluginServiceKey;
  /**
   * Opens one engine. The suite installs `RenderHostPlugin` and `ScreenPlugin` on it and
   * disposes it. Default: `createRealEngine({ variant: "light", maxEntities: 64, physicsHz: 60 })`.
   */
  readonly createEngine?: () => Promise<RealEngineHandle>;
}

interface Draw {
  readonly views: number;
  readonly alpha: number;
  readonly frameAlpha: number;
}

interface Session {
  readonly handle: RealEngineHandle;
  readonly engine: GwenEngine;
  readonly container: HTMLElement;
  readonly sizes: MockSizeProviderHandle;
  readonly draws: Draw[];
  readonly errors: string[];
  service: SurfaceRendererService | undefined;
}

const FRAME = 1 / 120;
const MAIN_CAMERA: CameraState = camera("main");

function camera(viewportId: string): CameraState {
  return {
    worldTransform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
    viewportId,
    active: true,
    priority: 0,
  };
}

function fail(what: string, cause?: unknown): GwenError {
  return new GwenError(RendererErrorCodes.CONFORMANCE_FAILED, what, {
    composable: "runSurfacePluginConformance",
    ...(cause === undefined ? {} : { cause }),
  });
}

async function defaultEngine(): Promise<RealEngineHandle> {
  const { createRealEngine } = await import("@gwenjs/core/testing");
  return createRealEngine({ variant: "light", maxEntities: 64, physicsHz: 60 });
}

/**
 * Check a surface renderer plugin on the real render host.
 *
 * It opens three engines (one page, one container each), installs `plugin()` on each and
 * checks: one connected canvas after start; `renderViews` once per `engine:render` with 0, 1
 * and 2 views and `engine.frame.alpha`; the canvas backing store follows `round(css * dpr)`
 * after a size change; `engine.stop()` removes the canvas, the layer and every call; two
 * engines keep two canvases and the second keeps rendering when the first stops; a plugin
 * installed after start is mounted at once. Every engine is disposed and every container removed.
 * It needs a DOM (`document`).
 *
 * @throws {GwenError} `RENDERER:CONFORMANCE_FAILED` on the first violation.
 */
export async function runSurfacePluginConformance(
  options: SurfacePluginConformanceOptions,
): Promise<void> {
  const sessions: Session[] = [];
  let failure: unknown;
  try {
    const first = await open(options, sessions);
    await install(first, options);
    await advance(first, 1, "after start");
    const canvas = hostCanvas(first);
    await checkDraws(first);
    checkResize(first, canvas);
    assertNoErrors(first, "during a size change");

    const second = await open(options, sessions);
    await install(second, options);
    await advance(second, 1, "after start");
    const secondCanvas = hostCanvas(second);
    checkTwoCanvases(first, second, canvas, secondCanvas);

    await checkStop(first, canvas);
    if (!secondCanvas.isConnected) {
      throw fail("stopping the first engine disconnected the canvas of the second engine.");
    }
    await advance(second, 1, "after the first one stopped", "the second engine");

    const late = await open(options, sessions);
    await late.handle.advance(1, FRAME);
    await install(late, options);
    hostCanvas(late, "a plugin installed after start was not mounted");
    await advance(late, 1, "after a late install");
  } catch (cause) {
    failure = cause;
  }
  let disposeFailure: unknown;
  for (const session of sessions.reverse()) {
    try {
      await session.handle.dispose();
    } catch (cause) {
      disposeFailure ??= cause;
    } finally {
      session.container.remove();
    }
  }
  if (failure !== undefined) throw failure;
  if (disposeFailure !== undefined) throw disposeFailure;
}

async function open(
  options: SurfacePluginConformanceOptions,
  sessions: Session[],
): Promise<Session> {
  const handle = await (options.createEngine ?? defaultEngine)();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const sizes = MockSizeProvider({ width: 800, height: 600, dpr: 2 });
  const session: Session = {
    handle,
    engine: handle.engine,
    container,
    sizes,
    draws: [],
    errors: [],
    service: undefined,
  };
  sessions.push(session);
  session.engine.errors.on((event) => {
    if (event.level === "error") session.errors.push(`${event.code} ${thrownText(event.message)}`);
  });
  await session.engine.use(RenderHostPlugin({ container }));
  await session.engine.use(ScreenPlugin({ sizeProvider: sizes }));
  return session;
}

async function install(session: Session, options: SurfacePluginConformanceOptions): Promise<void> {
  const { engine } = session;
  try {
    await engine.use(options.plugin());
  } catch (cause) {
    throw fail(`installing the plugin failed: ${thrownText(cause)}.`, cause);
  }
  const service = engine.tryInject(options.serviceKey);
  if (service === undefined) {
    throw fail(`the plugin provides nothing under "${options.serviceKey}".`);
  }
  if (!isSurface(service)) {
    throw fail(
      `"${options.serviceKey}" is not a surface renderer: its kind is ${String(Reflect.get(service, "kind"))}.`,
    );
  }
  const real = service.renderViews.bind(service);
  service.renderViews = (views: readonly RenderView[], alpha: number) => {
    session.draws.push({ views: views.length, alpha, frameAlpha: engine.frame.alpha });
    real(views, alpha);
  };
  session.service = service;
  assertNoErrors(session, "during install");
}

function isSurface(value: unknown): value is SurfaceRendererService {
  if (typeof value !== "object" || value === null) return false;
  return (
    Reflect.get(value, "kind") === "surface" &&
    typeof Reflect.get(value, "renderViews") === "function"
  );
}

function layerSelector(session: Session): string {
  return `[data-gwen-layer^="${session.service?.name ?? ""}:"]`;
}

function hostCanvas(session: Session, lead = "the plugin has no canvas"): HTMLCanvasElement {
  const nodes = session.container.querySelectorAll(layerSelector(session));
  const node = nodes[0];
  if (nodes.length !== 1 || node === undefined) {
    throw fail(
      `${lead}: found ${nodes.length} nodes with data-gwen-layer "${session.service?.name}:" in the host root, expected one canvas.`,
    );
  }
  if (!(node instanceof HTMLCanvasElement)) {
    throw fail(`the layer element of "${session.service?.name}" is not an HTMLCanvasElement.`);
  }
  if (!node.isConnected) throw fail("the canvas of the plugin is not connected.");
  return node;
}

/** `frames` frames of `FRAME` seconds. Returns the draws they made. */
async function advance(
  session: Session,
  frames: number,
  when: string,
  who = "the engine",
): Promise<Draw[]> {
  const from = session.draws.length;
  await session.handle.advance(frames, FRAME);
  const made = session.draws.slice(from);
  assertNoErrors(session, when, who);
  if (made.length !== frames) {
    throw fail(
      `renderViews was called ${made.length} times in ${frames} frames ${when}, expected ${frames} (once per engine:render).`,
    );
  }
  for (const draw of made) {
    if (draw.alpha !== draw.frameAlpha) {
      throw fail(
        `renderViews got alpha ${draw.alpha} while engine.frame.alpha was ${draw.frameAlpha}.`,
      );
    }
  }
  return made;
}

async function checkDraws(session: Session): Promise<void> {
  const cameras = session.engine.inject("cameraManager");
  const viewports = session.engine.inject("viewportManager");
  const none = await advance(session, 1, "with no camera");
  expectViews(none, 0);
  cameras.set("main", MAIN_CAMERA);
  expectViews(await advance(session, 3, "with one camera"), 1);
  viewports.set("side", { x: 0.5, y: 0, width: 0.5, height: 1 });
  cameras.set("side", camera("side"));
  expectViews(await advance(session, 1, "with two cameras"), 2);
}

/** Fail on any `level: "error"` event seen so far, including ones from install, resize and stop. */
function assertNoErrors(session: Session, when: string, who = "the engine"): void {
  const reported = session.errors[0];
  if (reported !== undefined) throw fail(`${who} reported an error ${when}: ${reported}.`);
}

function expectViews(draws: readonly Draw[], expected: number): void {
  for (const draw of draws) {
    if (draw.views !== expected) {
      throw fail(`renderViews got ${draw.views} views, expected ${expected}.`);
    }
  }
}

function checkResize(session: Session, canvas: HTMLCanvasElement): void {
  for (const [width, height, dpr] of [
    [640, 360, 3],
    [321, 181, 1.5],
  ] as const) {
    session.sizes.emit(width, height, dpr);
    const expectW = Math.round(width * dpr);
    const expectH = Math.round(height * dpr);
    if (canvas.width !== expectW || canvas.height !== expectH) {
      throw fail(
        `the canvas is ${canvas.width}x${canvas.height} after a size change to ${width}x${height} at dpr ${dpr}, expected ${expectW}x${expectH}.`,
      );
    }
  }
}

function checkTwoCanvases(
  first: Session,
  second: Session,
  firstCanvas: HTMLCanvasElement,
  secondCanvas: HTMLCanvasElement,
): void {
  const found = document.querySelectorAll(layerSelector(first));
  const connected = Array.from(found).filter((node) => node.isConnected);
  if (connected.length !== 2 || connected[0] === connected[1]) {
    throw fail(
      `two engines on one page must hold two canvases of "${first.service?.name}", found ${connected.length}.`,
    );
  }
  if (!first.container.contains(firstCanvas) || hostCanvas(first) !== firstCanvas) {
    throw fail("a canvas is outside the host root of its engine.");
  }
  if (!second.container.contains(secondCanvas) || hostCanvas(second) !== secondCanvas) {
    throw fail("a canvas is outside the host root of its engine.");
  }
}

async function checkStop(session: Session, canvas: HTMLCanvasElement): Promise<void> {
  const layers = session.engine.inject("layerManager");
  const drawsBefore = session.draws.length;
  await session.engine.stop();
  assertNoErrors(session, "after engine.stop()");
  if (canvas.isConnected) throw fail("the canvas is still connected after engine.stop().");
  if (session.container.querySelector(layerSelector(session)) !== null) {
    throw fail("a data-gwen-layer node of the plugin remains after engine.stop().");
  }
  if (layers.has(session.service?.name ?? "")) {
    throw fail(`layerManager still holds "${session.service?.name}" after engine.stop().`);
  }
  await session.engine.hooks.callHook("engine:render", 0);
  if (session.draws.length !== drawsBefore) {
    throw fail(`renderViews ran ${session.draws.length - drawsBefore} times after engine.stop().`);
  }
}

import { CoreErrorCodes } from "@gwenjs/core";
import type { GwenErrorPayload, GwenLogEntry, GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { advanceFrames, installPrerequisites, thrownMessage } from "./lifecycle.js";
import { withEngine } from "./open-engine.js";
import { runtimeFinding } from "./spec.js";
import type { RuntimeCheckContext } from "./types.js";

interface StampedEvent {
  readonly event: GwenErrorPayload;
  readonly frame: number;
}

function isReportedBusLevel(level: GwenErrorPayload["level"]): boolean {
  return level === "warning" || level === "error" || level === "fatal";
}

function isReportedLogLevel(level: GwenLogEntry["level"]): boolean {
  return level === "warn" || level === "error";
}

function contextString(event: GwenErrorPayload, key: string): string {
  const context: unknown = event.context;
  if (!isRecord(context)) return "";
  const value: unknown = context[key];
  if (typeof value !== "string") return "";
  return value;
}

function frameEventFinding(event: GwenErrorPayload, frame: number): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_FRAME_EVENT,
    message: `${event.code} ${event.message} frame ${frame}`,
    hint: "Stop emitting that event, or lower its level below warning.",
  };
}

function perEntityFinding(event: GwenErrorPayload): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_PER_ENTITY_PATH,
    message: `${event.code} api ${contextString(event, "api")} phase ${contextString(event, "phase")}`,
    hint: "Iterate the query by chunk (for (const chunk of query)).",
  };
}

function devWarningFinding(entry: GwenLogEntry): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_DEV_WARNING,
    message: `${entry.level} ${entry.message}`,
    hint: "Remove the warn or error call.",
  };
}

/**
 * A bus warning is copied to the logger as `warn` with the same message and
 * `payload.code` (`packages/core/src/engine/engine-error-policy.ts:408`).
 * That copy is not also `RUNTIME_DEV_WARNING`: the bus event is already
 * `RUNTIME_FRAME_EVENT` or `RUNTIME_PER_ENTITY_PATH`.
 * A direct `logger.warn` has no payload (`packages/plugin-conformance/tests/runtime/frames.test.ts:70-72`).
 */
function isBusCopy(entry: GwenLogEntry, events: readonly GwenErrorPayload[]): boolean {
  const payload: unknown = entry.payload;
  if (!isRecord(payload)) return false;
  const code: unknown = payload.code;
  if (typeof code !== "string") return false;
  for (const event of events) {
    if (event.code === code && event.message === entry.message) return true;
  }
  return false;
}

function collect(
  stamped: readonly StampedEvent[],
  logs: readonly GwenLogEntry[],
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const bus: GwenErrorPayload[] = [];
  for (const stampedEvent of stamped) {
    const event = stampedEvent.event;
    if (!isReportedBusLevel(event.level)) continue;
    bus.push(event);
    if (event.code === CoreErrorCodes.QUERY_PER_ENTITY_PATH) {
      findings.push(perEntityFinding(event));
      continue;
    }
    findings.push(frameEventFinding(event, stampedEvent.frame));
  }
  for (const entry of logs) {
    if (!isReportedLogLevel(entry.level)) continue;
    if (isBusCopy(entry, bus)) continue;
    findings.push(devWarningFinding(entry));
  }
  return findings;
}

/**
 * Bus events at warning, error, or fatal, and logger entries at warn or error,
 * in this window. A logger copy of a bus event is not a second finding
 * (`packages/core/src/engine/engine-error-policy.ts:407`).
 */
export function quietWindowFindings(
  code: ConformanceFinding["code"],
  hint: string,
  events: readonly GwenErrorPayload[],
  logs: readonly GwenLogEntry[],
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const bus: GwenErrorPayload[] = [];
  for (const event of events) {
    if (!isReportedBusLevel(event.level)) continue;
    bus.push(event);
    findings.push({ code, message: `${event.code} ${event.message}`, hint });
  }
  for (const entry of logs) {
    if (!isReportedLogLevel(entry.level)) continue;
    if (isBusCopy(entry, bus)) continue;
    findings.push({ code, message: `${entry.level} ${entry.message}`, hint });
  }
  return findings;
}

async function checkOne(
  context: RuntimeCheckContext,
  plugin: GwenPlugin,
): Promise<ConformanceFinding[]> {
  const spec = context.spec;
  return withEngine(spec, async (open) => {
    // hookable calls hooks in registration order
    // (`node_modules/.pnpm/hookable@6.1.0/node_modules/hookable/dist/index.mjs:102`, `:41`).
    // This counter runs before the plugin's `engine:update` hook, so an emit
    // inside that hook sees the 1-based index. `engine.frameCount` is still
    // the previous count (`packages/core/src/engine/engine-loop.ts:427`).
    let frame = 0;
    const stamped: StampedEvent[] = [];
    open.engine.hooks.hook("engine:update", () => {
      frame += 1;
    });
    open.engine.errors.on((event) => {
      stamped.push({ event, frame });
    });
    await installPrerequisites(open.engine, context);
    try {
      await open.engine.use(plugin);
    } catch {
      return [];
    }
    const fixture = spec.fixture;
    if (fixture !== undefined) {
      try {
        await fixture(open.engine);
      } catch (error: unknown) {
        return [
          runtimeFinding(
            `fixture threw: ${thrownMessage(error)}`,
            "Make fixture return without throwing.",
          ),
        ];
      }
    }
    try {
      await advanceFrames(open, spec);
    } catch {
      // A fatal event faults the engine. The next advance throws
      // (`packages/core/src/engine/engine-loop.ts:178`). The event is already stamped.
    }
    return collect(stamped, open.logs);
  });
}

/**
 * R4. One fresh engine per factory. Install `frameworkProviders`, `use` the plugin,
 * run `fixture` before the first advance, then advance `frames` (default 3) at `1/60`.
 */
export async function checkFrames(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context, created)));
  }
  return findings;
}

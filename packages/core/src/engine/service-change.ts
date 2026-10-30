import type { ServiceChangeEvent, ServiceChangeReason } from "@gwenjs/schema";
import { CoreErrorCodes } from "./engine-errors.js";
import { isThenable } from "./error-isolation.js";
import { popEngine, pushEngine } from "./engine-local.js";
import type { ServiceWriteResult } from "./service-container.js";
import type { GwenEngine } from "./engine-types.js";

export interface ServiceChangeNotice {
  readonly hook: "service:provided" | "service:removed";
  readonly key: string;
  readonly value: unknown;
  readonly owner: string | undefined;
  readonly reason: ServiceChangeReason;
}

function reportServiceHookFailure(
  engine: GwenEngine,
  hook: string,
  key: string,
  error: unknown,
): void {
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message: error instanceof Error ? error.message : String(error),
    source: hook,
    error,
    context: { hook, key },
  });
}

function runServiceListener(
  engine: GwenEngine,
  hook: ServiceChangeNotice["hook"],
  key: string,
  handler: (event: ServiceChangeEvent) => unknown,
  event: ServiceChangeEvent,
): void {
  const previous = pushEngine(engine);
  try {
    const result = handler(event);
    if (isThenable(result)) {
      void Promise.resolve(result).then(undefined, (rejected: unknown) => {
        reportServiceHookFailure(engine, hook, key, rejected);
      });
    }
  } catch (error) {
    reportServiceHookFailure(engine, hook, key, error);
  } finally {
    popEngine(engine, previous);
  }
}

function fireServiceChange(
  engine: GwenEngine,
  hook: ServiceChangeNotice["hook"],
  key: string,
  event: ServiceChangeEvent,
): void {
  const args: [ServiceChangeEvent] = [event];
  engine.hooks.callHookWith(
    (hookList) => {
      for (const handler of hookList) {
        runServiceListener(engine, hook, key, handler, event);
      }
    },
    hook,
    args,
  );
}

export function emitServiceChange(engine: GwenEngine, notice: ServiceChangeNotice): void {
  // The registry only emits keys it stored; value comes from the same store.
  const event = {
    key: notice.key,
    value: notice.value,
    owner: notice.owner,
    reason: notice.reason,
  } as ServiceChangeEvent;
  if (notice.hook === "service:removed") {
    fireServiceChange(engine, "service:removed", notice.key, event);
  } else {
    fireServiceChange(engine, "service:provided", notice.key, event);
  }
}

export function announceDirectWrite(
  engine: GwenEngine,
  key: string,
  value: unknown,
  write: ServiceWriteResult,
): void {
  if (write.kind === "overwrite") {
    emitServiceChange(engine, {
      hook: "service:removed",
      key,
      value: write.previous,
      owner: undefined,
      reason: "overwrite",
    });
  }
  if (write.kind === "created" || write.kind === "overwrite") {
    emitServiceChange(engine, {
      hook: "service:provided",
      key,
      value,
      owner: undefined,
      reason: write.kind === "created" ? "install" : "overwrite",
    });
  }
}

/**
 * Attach a rejection handler to a fire-and-forget `callHook` result.
 *
 * A sync return is ignored. A rejected promise is published once on the
 * error bus, at level `error`, with no `target`: a rejected `callHook` does
 * not say which listener failed, so nothing is isolated (#55 attribution
 * invariant).
 */

import { CoreErrorCodes } from "../engine/engine-errors.js";
import { isThenable } from "../engine/error-isolation.js";

interface RejectedHookHost {
  errors: {
    emit(payload: {
      level: "error";
      code: string;
      message: string;
      source?: string;
      error?: unknown;
      context?: Record<string, unknown>;
    }): void;
  };
  frameCount: number;
}

export function reportRejectedHook(
  engine: RejectedHookHost | null,
  source: string,
  hook: string,
  result: unknown,
): void {
  if (engine === null || !isThenable(result)) return;
  void Promise.resolve(result).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    engine.errors.emit({
      level: "error",
      code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message,
      source,
      error,
      context: { frame: engine.frameCount, hook },
    });
  });
}

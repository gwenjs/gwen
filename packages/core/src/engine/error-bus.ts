/**
 * Engine error bus.
 *
 * `emit` runs every `on` handler synchronously.
 * A fatal event then runs every `onFatal` callback, still inside `emit`.
 * A handler that throws is logged with `CORE:ERROR_HANDLER_FAILED` and does not escape `emit`.
 * That failure is never emitted on the bus.
 *
 * `install` attaches `window.onerror` and `unhandledrejection`
 * and forwards those failures onto the bus.
 * It returns a function that removes those handlers. A second call returns the same function.
 *
 * Pass `{ logger }` or the legacy `(error) => void` callback. The callback receives the raw throw.
 */

import type { GwenErrorPayload, IGwenLogger } from "@gwenjs/schema";
import type { EngineErrorBus } from "./engine-types.js";
import { CoreErrorCodes } from "./engine-errors.js";

type ErrorHandler = (event: GwenErrorPayload) => void;

export interface CreateErrorBusOptions {
  /** Receives handler failures. Defaults to `console.error`. */
  logger?: IGwenLogger;
}

function thrownMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function uncaughtMessage(message: string | Event): string {
  return typeof message === "string" ? message : "Uncaught error";
}

export function createErrorBus(
  options?: CreateErrorBusOptions | ((error: unknown) => void),
): EngineErrorBus {
  const reportHandlerError = typeof options === "function" ? options : undefined;
  const logger = typeof options === "function" ? undefined : options?.logger;
  const handlers: ErrorHandler[] = [];
  const fatalHandlers: Array<() => void> = [];
  let installed = false;
  let uninstall = (): void => {};

  function reportHandlerFailure(error: unknown): void {
    if (reportHandlerError) {
      reportHandlerError(error);
      return;
    }
    const detail = thrownMessage(error);
    const message = `[${CoreErrorCodes.ERROR_HANDLER_FAILED}] ${detail}`;
    if (logger) {
      logger.error(message, { code: CoreErrorCodes.ERROR_HANDLER_FAILED });
      return;
    }
    // Default sink when the caller did not pass a logger or a report callback.
    console.error(message);
  }

  function isolate(run: () => void): void {
    try {
      run();
    } catch (error: unknown) {
      reportHandlerFailure(error);
    }
  }

  const bus: EngineErrorBus = {
    emit(event) {
      for (const handler of handlers.slice()) {
        isolate(() => handler(event));
      }
      if (event.level !== "fatal") return;
      for (const callback of fatalHandlers.slice()) {
        isolate(callback);
      }
    },
    on(handler) {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
      };
    },
    onFatal(callback) {
      fatalHandlers.push(callback);
      return () => {
        const index = fatalHandlers.indexOf(callback);
        if (index !== -1) fatalHandlers.splice(index, 1);
      };
    },
    install() {
      if (installed) return uninstall;
      installed = true;
      if (typeof window === "undefined") {
        uninstall = () => {
          if (!installed) return;
          installed = false;
        };
        return uninstall;
      }

      const previous = window.onerror;
      const onUnhandled = (event: PromiseRejectionEvent): void => {
        const reason: unknown = event.reason;
        bus.emit({
          level: "error",
          code: CoreErrorCodes.UNHANDLED_REJECTION,
          message: thrownMessage(reason),
          error: reason,
        });
      };
      const onError: OnErrorEventHandler = (message, source, lineno, colno, error) => {
        const context: Record<string, unknown> = {};
        if (typeof lineno === "number") context.line = lineno;
        if (typeof colno === "number") context.column = colno;
        const payload: GwenErrorPayload = {
          level: "error",
          code: CoreErrorCodes.UNCAUGHT_ERROR,
          message: uncaughtMessage(message),
          error,
        };
        if (typeof source === "string") payload.source = source;
        if (Object.keys(context).length > 0) payload.context = context;
        bus.emit(payload);
        if (typeof previous === "function") {
          const result: unknown = previous.call(window, message, source, lineno, colno, error);
          return result === true;
        }
        return false;
      };
      window.onerror = onError;
      window.addEventListener("unhandledrejection", onUnhandled);

      uninstall = () => {
        if (!installed) return;
        installed = false;
        if (window.onerror === onError) window.onerror = previous;
        window.removeEventListener("unhandledrejection", onUnhandled);
      };
      return uninstall;
    },
  };

  return bus;
}

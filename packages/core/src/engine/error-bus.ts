/**
 * Engine error bus.
 *
 * `emit` runs every `on` handler synchronously.
 * A fatal event then runs every `onFatal` callback, still inside `emit`.
 * A handler that throws is reported and does not escape `emit`.
 *
 * `install` attaches `window.onerror` and `unhandledrejection`
 * and forwards those failures onto the bus.
 * It returns a function that removes those handlers.
 */

import type { GwenErrorPayload } from "@gwenjs/schema";
import type { EngineErrorBus } from "./engine-types.js";

const UNCAUGHT_ERROR = "CORE:UNCAUGHT_ERROR";
const UNHANDLED_REJECTION = "CORE:UNHANDLED_REJECTION";

type ErrorHandler = (event: GwenErrorPayload) => void;

function thrownMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function uncaughtMessage(message: string | Event): string {
  return typeof message === "string" ? message : "Uncaught error";
}

export function createErrorBus(reportHandlerError?: (error: unknown) => void): EngineErrorBus {
  const handlers: ErrorHandler[] = [];
  const fatalHandlers: Array<() => void> = [];
  let installed = false;
  let uninstall = (): void => {};

  function isolate(run: () => void): void {
    try {
      run();
    } catch (error: unknown) {
      reportHandlerError?.(error);
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
    },
    onFatal(callback) {
      fatalHandlers.push(callback);
    },
    install() {
      if (installed) return uninstall;
      if (typeof window === "undefined") return () => {};
      installed = true;

      const previous = window.onerror;
      const onUnhandled = (event: PromiseRejectionEvent): void => {
        const reason: unknown = event.reason;
        bus.emit({
          level: "error",
          code: UNHANDLED_REJECTION,
          message: thrownMessage(reason),
          error: reason,
        });
      };
      window.onerror = (message, source, lineno, colno, error) => {
        const context: Record<string, unknown> = {};
        if (typeof lineno === "number") context.line = lineno;
        if (typeof colno === "number") context.column = colno;
        const payload: GwenErrorPayload = {
          level: "error",
          code: UNCAUGHT_ERROR,
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

      window.addEventListener("unhandledrejection", onUnhandled);

      uninstall = () => {
        if (!installed) return;
        installed = false;
        window.onerror = previous;
        window.removeEventListener("unhandledrejection", onUnhandled);
      };
      return uninstall;
    },
  };

  return bus;
}

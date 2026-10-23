import type { IGwenLogProvider } from "@gwenjs/schema";

/**
 * Creates a log provider that writes to the browser/Node.js console.
 *
 * Output format: `[tag#entityId] message {payload} frame=<n>` — or `[gwen] message`
 * when no tag is set. `frame=<n>` is a last argument only when `frame` is defined,
 * including `frame=0`. Uses the matching `console[level]` method so dev-tools can
 * filter by severity.
 *
 * This is the default provider used by the engine when `logger.providers` is omitted.
 */
export function consoleLogProvider(): IGwenLogProvider {
  return {
    handle({ level, message, tag, entityId, payload, frame }) {
      const prefix = tag ? `[${tag}${entityId ? `#${entityId}` : ""}]` : "[gwen]";
      const args: unknown[] = payload ? [prefix, message, payload] : [prefix, message];
      if (frame !== undefined) args.push(`frame=${frame}`);
      console[level](...args);
    },
  };
}

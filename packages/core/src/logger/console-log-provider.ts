import type { IGwenLogProvider } from '@gwenjs/schema';

/**
 * Creates a log provider that writes to the browser/Node.js console.
 *
 * Output format: `[tag#entityId] message {payload}` — or `[gwen] message` when
 * no tag is set. Uses the matching `console[level]` method so dev-tools can
 * filter by severity.
 *
 * This is the default provider used by `setupGwen` when `config.logger` is absent.
 */
export function consoleLogProvider(): IGwenLogProvider {
  return {
    handle({ level, message, tag, entityId, payload }) {
      const prefix = tag
        ? `[${tag}${entityId ? `#${entityId}` : ''}]`
        : '[gwen]';
      const args: unknown[] = payload ? [prefix, message, payload] : [prefix, message];
      console[level](...args);
    }
  };
}

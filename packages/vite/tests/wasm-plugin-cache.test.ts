/**
 * Tests for the build-mode WASM base64 caching behaviour in gwenWasmPlugin.
 *
 * `vi.mock` is hoisted by Vitest before any imports, allowing us to intercept
 * the `node:fs` calls that the plugin makes internally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be declared before the module under test is imported.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from('fake-wasm-bytes')),
  };
});

// Also mock `node:module` so `createRequire` returns a safe resolver without
// hitting the real filesystem for @gwenjs/core.
vi.mock('node:module', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:module')>();
  return {
    ...original,
    createRequire: () => {
      const req = (id: string) => `/mock/node_modules/${id}`;
      req.resolve = (id: string) => `/mock/node_modules/${id}`;
      return req;
    },
  };
});

import { readFileSync, existsSync } from 'node:fs';
import { gwenWasmPlugin } from '../src/plugins/wasm.js';

const RESOLVED_ID = '\0virtual:gwen/wasm';

/** Helper: call the plugin's configResolved hook. */
function applyConfig(plugin: ReturnType<typeof gwenWasmPlugin>, command: 'build' | 'serve') {
  if (typeof plugin.configResolved === 'function') {
    plugin.configResolved.call({} as never, { command } as never);
  }
}

/** Helper: call the plugin's load hook and return the result. */
function callLoad(plugin: ReturnType<typeof gwenWasmPlugin>) {
  const load = plugin.load;
  if (typeof load !== 'function') throw new Error('[test] load hook must be a function');
  return load.call({} as never, RESOLVED_ID, undefined);
}

describe('gwenWasmPlugin – build cache', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockClear();
    vi.mocked(existsSync).mockClear();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake-wasm-bytes') as never);
  });

  it('should cache base64 result across multiple load calls in build mode', () => {
    const plugin = gwenWasmPlugin({ wasm: { variant: 'debug' } });
    applyConfig(plugin, 'build');

    // First call — reads the file
    const result1 = callLoad(plugin);
    // Second call — should hit the cache, NOT read again
    const result2 = callLoad(plugin);

    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);
    // Both calls must return the same base64 inline URL
    expect(result1).toBe(result2);
    expect(result1).toContain('data:application/wasm;base64,');
  });

  it('should not cache in serve/dev mode', () => {
    const plugin = gwenWasmPlugin({ wasm: { variant: 'debug' } });
    applyConfig(plugin, 'serve');

    const result1 = callLoad(plugin);
    const result2 = callLoad(plugin);

    // Dev mode returns a URL string — readFileSync is never called
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(0);
    expect(result1).toContain('/@gwen-wasm/');
    expect(result2).toContain('/@gwen-wasm/');
  });

  it('should invalidate cache when configResolved is called again', () => {
    const plugin = gwenWasmPlugin({ wasm: { variant: 'debug' } });
    applyConfig(plugin, 'build');

    // First build cycle — populates cache
    callLoad(plugin);
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);

    // Simulate a second build (configResolved resets the cache)
    applyConfig(plugin, 'build');

    // Second build cycle — cache cleared, must re-read
    callLoad(plugin);
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(2);
  });

  it('should return correct base64-encoded content', () => {
    const content = 'hello-wasm';
    vi.mocked(readFileSync).mockReturnValue(Buffer.from(content) as never);

    const plugin = gwenWasmPlugin({ wasm: { variant: 'debug' } });
    applyConfig(plugin, 'build');

    const result = callLoad(plugin) as string;
    const expected = Buffer.from(content).toString('base64');
    expect(result).toContain(expected);
  });
});

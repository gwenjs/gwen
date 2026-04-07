/**
 * @file cleanup-context unit tests
 *
 * Verifies:
 * - onCleanup() silently no-ops outside any cleanup context
 * - withCleanup() establishes a context and returns [result, dispose]
 * - dispose fires registered callbacks in LIFO order
 * - dispose cleans up context even when fn throws
 * - nested withCleanup() isolates inner and outer contexts
 * - onCleanup() registers in the innermost context
 */

import { describe, it, expect, vi } from 'vitest';
import { onCleanup, withCleanup } from '../../src/cleanup-context';

// ── onCleanup() outside context ──────────────────────────────────────────────

describe('onCleanup() outside context', () => {
  it('silently no-ops when called with no active context', () => {
    expect(() => {
      onCleanup(() => {
        throw new Error('This should not run');
      });
    }).not.toThrow();
  });

  it('does not throw', () => {
    const callback = vi.fn();
    expect(() => onCleanup(callback)).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});

// ── withCleanup() ────────────────────────────────────────────────────────────

describe('withCleanup()', () => {
  it('returns the function result as first element', () => {
    const [result, _dispose] = withCleanup(() => {
      return { id: 42, name: 'test' };
    });
    expect(result).toEqual({ id: 42, name: 'test' });
  });

  it('returns a dispose function as second element', () => {
    const [_result, dispose] = withCleanup(() => 'value');
    expect(typeof dispose).toBe('function');
  });

  it('dispose fires registered cleanup callbacks', () => {
    const callback = vi.fn();
    const [_result, dispose] = withCleanup(() => {
      onCleanup(callback);
      return null;
    });
    expect(callback).not.toHaveBeenCalled();
    dispose();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('dispose fires callbacks in FIFO order', () => {
    const order: number[] = [];
    const [_result, dispose] = withCleanup(() => {
      onCleanup(() => order.push(1));
      onCleanup(() => order.push(2));
      onCleanup(() => order.push(3));
      return null;
    });
    dispose();
    expect(order).toEqual([1, 2, 3]);
  });

  it('cleans up context even when fn throws', () => {
    let caughtError = false;
    let dispose: (() => void) | null = null;
    try {
      const result = withCleanup(() => {
        throw new Error('fn threw');
      });
      dispose = result[1];
    } catch {
      caughtError = true;
    }
    expect(caughtError).toBe(true);
    expect(dispose).toBeNull();
  });

  it('does not fire dispose callbacks if fn throws (context cleaned up)', () => {
    const callback = vi.fn();
    let dispose: (() => void) | null = null;
    let caughtError = false;
    try {
      const result = withCleanup(() => {
        onCleanup(callback);
        throw new Error('fn threw');
      });
      dispose = result[1];
    } catch {
      caughtError = true;
    }
    expect(caughtError).toBe(true);
    expect(dispose).toBeNull();
    expect(callback).not.toHaveBeenCalled();
  });
});

// ── nested withCleanup() ─────────────────────────────────────────────────────

describe('nested withCleanup()', () => {
  it('inner cleanup does not fire outer callbacks', () => {
    const outerCallback = vi.fn();
    const [_result, outerDispose] = withCleanup(() => {
      onCleanup(outerCallback);

      const [_innerResult, innerDispose] = withCleanup(() => {
        const innerCallback = vi.fn();
        onCleanup(innerCallback);
        return 'inner';
      });

      innerDispose();
      return 'outer';
    });

    expect(outerCallback).not.toHaveBeenCalled();
    outerDispose();
    expect(outerCallback).toHaveBeenCalledOnce();
  });

  it('outer cleanup does not fire inner callbacks', () => {
    const innerCallback = vi.fn();
    const outerCallback = vi.fn();

    const [_result, outerDispose] = withCleanup(() => {
      onCleanup(outerCallback);

      const [_innerResult, _innerDispose] = withCleanup(() => {
        onCleanup(innerCallback);
        return 'inner';
      });

      return 'outer';
    });

    outerDispose();
    expect(outerCallback).toHaveBeenCalledOnce();
    expect(innerCallback).not.toHaveBeenCalled();
  });

  it('onCleanup() registers in the innermost context', () => {
    const order: string[] = [];

    const [_result, outerDispose] = withCleanup(() => {
      onCleanup(() => order.push('outer'));

      const [_innerResult, innerDispose] = withCleanup(() => {
        onCleanup(() => order.push('inner'));
        return null;
      });

      innerDispose();
      return null;
    });

    expect(order).toEqual(['inner']);
    outerDispose();
    expect(order).toEqual(['inner', 'outer']);
  });
});

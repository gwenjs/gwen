/**
 * @file onSensorEnter() / onSensorExit() composable tests.
 */
import { describe, it, expect } from 'vitest';
import {
  _dispatchSensorEnter,
  _dispatchSensorExit,
  onSensorEnter,
  onSensorExit,
  _clearSensorCallbacks,
} from '../../src/composables/on-sensor.js';

describe('onSensorEnter / _dispatchSensorEnter', () => {
  it('fires the callback when the correct sensor ID is dispatched', () => {
    let received: bigint | null = null;
    onSensorEnter(5, (id) => {
      received = id;
    });
    _dispatchSensorEnter(5, 42n);
    expect(received).toBe(42n);
  });

  it('does not fire for a different sensor ID', () => {
    let received: bigint | null = null;
    onSensorEnter(5, (id) => {
      received = id;
    });
    _dispatchSensorEnter(9, 42n);
    expect(received).toBeNull();
  });

  it('supports multiple callbacks for the same sensor ID', () => {
    const results: bigint[] = [];
    onSensorEnter(3, (id) => results.push(id));
    onSensorEnter(3, (id) => results.push(id * 2n));
    _dispatchSensorEnter(3, 10n);
    expect(results).toEqual([10n, 20n]);
  });

  it('does not throw when dispatching to a sensor with no callbacks', () => {
    expect(() => _dispatchSensorEnter(999, 1n)).not.toThrow();
  });
});

describe('onSensorExit / _dispatchSensorExit', () => {
  it('fires the exit callback when dispatched', () => {
    let received: bigint | null = null;
    onSensorExit(7, (id) => {
      received = id;
    });
    _dispatchSensorExit(7, 33n);
    expect(received).toBe(33n);
  });

  it('does not fire for a different sensor ID', () => {
    let received: bigint | null = null;
    onSensorExit(7, (id) => {
      received = id;
    });
    _dispatchSensorExit(8, 33n);
    expect(received).toBeNull();
  });

  it('does not throw when dispatching to a sensor with no exit callbacks', () => {
    expect(() => _dispatchSensorExit(888, 1n)).not.toThrow();
  });
});

describe('onSensorEnter and onSensorExit independence', () => {
  it('enter dispatch does not trigger exit callbacks', () => {
    let exitFired = false;
    onSensorExit(1, () => {
      exitFired = true;
    });
    _dispatchSensorEnter(1, 1n);
    expect(exitFired).toBe(false);
  });

  it('exit dispatch does not trigger enter callbacks', () => {
    let enterFired = false;
    onSensorEnter(2, () => {
      enterFired = true;
    });
    _dispatchSensorExit(2, 1n);
    expect(enterFired).toBe(false);
  });

  it('_clearSensorCallbacks removes enter/exit callbacks', () => {
    let enterCalled = false;
    onSensorEnter(10, () => {
      enterCalled = true;
    });
    _clearSensorCallbacks(10);
    _dispatchSensorEnter(10, 1n);
    expect(enterCalled).toBe(false);
  });
});

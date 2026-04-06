import { describe, it, expect, beforeEach } from 'vitest';
import {
  onContact,
  _dispatchContactEvent,
  _clearContactCallbacks,
} from '../../src/composables/on-contact.js';
import type { Physics3DCollisionContact } from '../../src/types.js';
import type { EntityId } from '@gwenjs/core';

const sampleContact: Physics3DCollisionContact = {
  entityA: 1n as unknown as EntityId,
  entityB: 2n as unknown as EntityId,
  aColliderId: 10,
  bColliderId: 20,
  started: true,
};

describe('onContact / _dispatchContactEvent', () => {
  beforeEach(() => {
    _clearContactCallbacks();
  });

  it('registered callback is invoked on dispatch', () => {
    const received: Physics3DCollisionContact[] = [];
    onContact((e) => received.push(e));
    _dispatchContactEvent(sampleContact);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(sampleContact);
  });

  it('multiple callbacks are all invoked', () => {
    let count = 0;
    onContact(() => count++);
    onContact(() => count++);
    onContact(() => count++);
    _dispatchContactEvent(sampleContact);
    expect(count).toBe(3);
  });

  it('callback receives contact with started: true', () => {
    let receivedStarted: boolean | undefined;
    onContact((e) => {
      receivedStarted = e.started;
    });
    _dispatchContactEvent(sampleContact);
    expect(receivedStarted).toBe(true);
  });

  it('callback receives contact with correct collider IDs', () => {
    let receivedAColliderId: number | undefined;
    onContact((e) => {
      receivedAColliderId = e.aColliderId;
    });
    _dispatchContactEvent(sampleContact);
    expect(receivedAColliderId).toBe(10);
  });

  it('no callbacks invoked after _clearContactCallbacks()', () => {
    let invoked = false;
    onContact(() => {
      invoked = true;
    });
    _clearContactCallbacks();
    _dispatchContactEvent(sampleContact);
    expect(invoked).toBe(false);
  });

  it('dispatch with no callbacks does not throw', () => {
    expect(() => _dispatchContactEvent(sampleContact)).not.toThrow();
  });

  it('callback receives ended contact (started: false)', () => {
    let receivedStarted: boolean | undefined;
    onContact((e) => {
      receivedStarted = e.started;
    });
    _dispatchContactEvent({ ...sampleContact, started: false });
    expect(receivedStarted).toBe(false);
  });

  it('returned unregister function removes the callback', () => {
    let count = 0;
    const unregister = onContact(() => count++);
    _dispatchContactEvent(sampleContact);
    expect(count).toBe(1);
    unregister();
    _dispatchContactEvent(sampleContact);
    expect(count).toBe(1); // no additional invocation
  });

  it('calling unregister twice does not throw', () => {
    const unregister = onContact(() => {});
    unregister();
    expect(() => unregister()).not.toThrow();
  });
});

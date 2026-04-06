import { describe, expect, it, vi } from 'vitest';
import { applyDirectionalImpulse, moveKinematicByVelocity } from '../src/helpers/movement';

describe('movement helpers', () => {
  it('should move kinematic body by velocity * dt', () => {
    const setKinematicPosition = vi.fn();
    const physics = {
      getPosition: () => ({ x: 10, y: 20, rotation: 0 }),
      setKinematicPosition,
    } as any;

    moveKinematicByVelocity(physics, 5, { x: 4, y: -2 }, 0.5);
    expect(setKinematicPosition).toHaveBeenCalledWith(5, 12, 19);
  });

  it('should no-op when dt <= 0', () => {
    const setKinematicPosition = vi.fn();
    const physics = {
      getPosition: () => ({ x: 0, y: 0, rotation: 0 }),
      setKinematicPosition,
    } as any;

    moveKinematicByVelocity(physics, 1, { x: 2, y: 2 }, 0);
    expect(setKinematicPosition).not.toHaveBeenCalled();
  });

  it('should no-op when dt is negative', () => {
    const setKinematicPosition = vi.fn();
    const physics = {
      getPosition: () => ({ x: 0, y: 0, rotation: 0 }),
      setKinematicPosition,
    } as any;

    moveKinematicByVelocity(physics, 1, { x: 5, y: 5 }, -1);
    expect(setKinematicPosition).not.toHaveBeenCalled();
  });

  it('should no-op when dt is NaN', () => {
    const setKinematicPosition = vi.fn();
    const physics = {
      getPosition: () => ({ x: 0, y: 0, rotation: 0 }),
      setKinematicPosition,
    } as any;

    moveKinematicByVelocity(physics, 1, { x: 5, y: 5 }, NaN);
    expect(setKinematicPosition).not.toHaveBeenCalled();
  });

  it('should no-op when body position is unavailable', () => {
    const setKinematicPosition = vi.fn();
    const physics = {
      getPosition: () => null,
      setKinematicPosition,
    } as any;

    moveKinematicByVelocity(physics, 1, { x: 2, y: 2 }, 1);
    expect(setKinematicPosition).not.toHaveBeenCalled();
  });

  it('should normalize direction before applying impulse', () => {
    const applyImpulse = vi.fn();
    const physics = { applyImpulse } as any;

    applyDirectionalImpulse(physics, 3, { x: 10, y: 0 }, 5);
    expect(applyImpulse).toHaveBeenCalledWith(3, 5, 0);
  });

  it('should normalize diagonal direction', () => {
    const applyImpulse = vi.fn();
    const physics = { applyImpulse } as any;

    applyDirectionalImpulse(physics, 1, { x: 1, y: 1 }, Math.SQRT2);
    expect(applyImpulse.mock.calls[0][1]).toBeCloseTo(1);
    expect(applyImpulse.mock.calls[0][2]).toBeCloseTo(1);
  });

  it('should no-op with zero direction vector', () => {
    const applyImpulse = vi.fn();
    const physics = { applyImpulse } as any;

    applyDirectionalImpulse(physics, 3, { x: 0, y: 0 }, 10);
    expect(applyImpulse).not.toHaveBeenCalled();
  });

  it('should no-op when magnitude is zero', () => {
    const applyImpulse = vi.fn();
    const physics = { applyImpulse } as any;

    applyDirectionalImpulse(physics, 3, { x: 1, y: 0 }, 0);
    expect(applyImpulse).not.toHaveBeenCalled();
  });

  it('should no-op when magnitude is NaN', () => {
    const applyImpulse = vi.fn();
    const physics = { applyImpulse } as any;

    applyDirectionalImpulse(physics, 3, { x: 1, y: 0 }, NaN);
    expect(applyImpulse).not.toHaveBeenCalled();
  });
});

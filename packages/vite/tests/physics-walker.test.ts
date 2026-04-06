import { describe, it, expect } from 'vitest';
import { PhysicsQueryWalker } from '../src/optimizer/physics-walker';

const SYSTEM_WITH_CAST_RAY = `
import { defineSystem, onUpdate } from '@gwenjs/core';
import { usePhysics3D } from '@gwenjs/physics3d';

export const raycastSystem = defineSystem(() => {
  const physics = usePhysics3D();

  onUpdate((dt) => {
    const hit = physics.castRay({ origin: [0, 0, 0], direction: [0, -1, 0] });
  });
});
`;

const SYSTEM_WITH_CAST_RAY_AT_SETUP = `
import { defineSystem, onUpdate } from '@gwenjs/core';
import { usePhysics3D } from '@gwenjs/physics3d';

export const setupOnlySystem = defineSystem(() => {
  const physics = usePhysics3D();
  // castRay at setup level — should NOT be flagged
  const hit = physics.castRay({ origin: [0, 0, 0], direction: [0, -1, 0] });

  onUpdate((dt) => {
    // no physics calls inside update
  });
});
`;

const SYSTEM_WITH_CAST_SHAPE_AFTER_UPDATE = `
import { defineSystem, onAfterUpdate } from '@gwenjs/core';
import { usePhysics3D } from '@gwenjs/physics3d';

export const shapeSystem = defineSystem(() => {
  const physics = usePhysics3D();

  onAfterUpdate(() => {
    const overlap = physics.castShape({ shape: 'box', halfExtents: [1, 1, 1] });
  });
});
`;

const SYSTEM_WITH_OVERLAP_SHAPE = `
import { defineSystem, onUpdate } from '@gwenjs/core';
import { usePhysics3D } from '@gwenjs/physics3d';

export const overlapSystem = defineSystem(() => {
  const physics = usePhysics3D();

  onUpdate(() => {
    const results = physics.overlapShape({ shape: 'sphere', radius: 2 });
  });
});
`;

const SYSTEM_WITH_USE_RAYCAST = `
import { defineSystem, onUpdate } from '@gwenjs/core';
import { useRaycast } from '@gwenjs/physics3d';

// useRaycast composable — already optimized, should NOT be flagged
export const composableSystem = defineSystem(() => {
  const hit = useRaycast({ origin: [0, 0, 0], direction: [0, -1, 0] });

  onUpdate((dt) => {
    if (hit.value) { /* do something */ }
  });
});
`;

const NON_PHYSICS_SOURCE = `
import { defineSystem, onUpdate } from '@gwenjs/core';

export const movementSystem = defineSystem(() => {
  onUpdate((dt) => {
    // no physics calls here
    console.log('update', dt);
  });
});
`;

describe('PhysicsQueryWalker', () => {
  it('detects physics.castRay inside onUpdate', () => {
    const walker = new PhysicsQueryWalker('test.ts');
    const patterns = walker.walk(SYSTEM_WITH_CAST_RAY);
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.method).toBe('castRay');
    expect(patterns[0]!.callbackType).toBe('onUpdate');
    expect(patterns[0]!.filename).toBe('test.ts');
    expect(typeof patterns[0]!.start).toBe('number');
    expect(typeof patterns[0]!.end).toBe('number');
  });

  it('does NOT flag physics.castRay at setup level', () => {
    const walker = new PhysicsQueryWalker('test.ts');
    const patterns = walker.walk(SYSTEM_WITH_CAST_RAY_AT_SETUP);
    expect(patterns).toEqual([]);
  });

  it('detects physics.castShape inside onAfterUpdate', () => {
    const walker = new PhysicsQueryWalker('test.ts');
    const patterns = walker.walk(SYSTEM_WITH_CAST_SHAPE_AFTER_UPDATE);
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.method).toBe('castShape');
    expect(patterns[0]!.callbackType).toBe('onAfterUpdate');
  });

  it('detects physics.overlapShape inside onUpdate', () => {
    const walker = new PhysicsQueryWalker('test.ts');
    const patterns = walker.walk(SYSTEM_WITH_OVERLAP_SHAPE);
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.method).toBe('overlapShape');
    expect(patterns[0]!.callbackType).toBe('onUpdate');
  });

  it('does NOT flag useRaycast composable (already optimized)', () => {
    const walker = new PhysicsQueryWalker('test.ts');
    const patterns = walker.walk(SYSTEM_WITH_USE_RAYCAST);
    expect(patterns).toEqual([]);
  });

  it('returns empty array for non-physics source', () => {
    const walker = new PhysicsQueryWalker('test.ts');
    const patterns = walker.walk(NON_PHYSICS_SOURCE);
    expect(patterns).toEqual([]);
  });

  it('does NOT flag someOtherService.castRay() inside onUpdate', () => {
    const src = `
      export const sys = defineSystem(() => {
        onUpdate(() => { renderer.castRay(opts); });
      });
    `;
    const walker = new PhysicsQueryWalker('test.ts');
    expect(walker.walk(src)).toHaveLength(0);
  });
});

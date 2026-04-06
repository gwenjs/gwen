import { describe, it, expectTypeOf } from 'vitest';

describe('global default type strictness', () => {
  it('GwenPrefabExtensions has open index signature', () => {
    expectTypeOf<GwenPrefabExtensions>().toMatchTypeOf<Record<string, unknown>>();
  });
});

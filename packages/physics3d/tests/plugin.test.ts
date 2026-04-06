import { describe, it, expect } from 'vitest';
import Physics3DPlugin, { Physics3DPlugin as NamedPhysics3DPlugin } from '../src/index';

describe('Physics3DPlugin foundation', () => {
  it('exports default and named plugin class', () => {
    expect(Physics3DPlugin).toBeDefined();
    expect(NamedPhysics3DPlugin).toBeDefined();
  });

  it('instantiates with expected plugin name', () => {
    const plugin = new Physics3DPlugin();
    expect(plugin.name).toBe('@gwenjs/physics3d');
  });
});

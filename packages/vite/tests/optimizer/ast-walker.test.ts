import { describe, it, expect } from 'vitest';
import { AstWalker } from '../../src/optimizer/ast-walker';

const SYSTEM_CODE = `
import { useQuery, onUpdate, useComponent } from '@gwenjs/core'
import { Position, Velocity } from './components'

export const movementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const e of entities) {
      const pos = useComponent(e, Position)
      const vel = useComponent(e, Velocity)
      useComponent(e, Position, { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt })
    }
  })
})
`;

describe('AstWalker', () => {
  it('detects a useQuery call and its component names', () => {
    const walker = new AstWalker('test.ts');
    const findings = walker.walk(SYSTEM_CODE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.queryComponents).toContain('Position');
    expect(findings[0]!.queryComponents).toContain('Velocity');
  });

  it('detects read components from useComponent calls', () => {
    const walker = new AstWalker('test.ts');
    const findings = walker.walk(SYSTEM_CODE);
    expect(findings[0]!.readComponents).toContain('Position');
    expect(findings[0]!.readComponents).toContain('Velocity');
  });

  it('returns empty array for unparseable source', () => {
    const walker = new AstWalker('test.ts');
    // Pass a string that contains 'useQuery' (to bypass the early return)
    // but is syntactically invalid so the parser throws.
    const findings = walker.walk('useQuery(!!!invalid syntax @@@');
    expect(findings).toEqual([]);
  });

  it('returns empty array for source with no defineSystem', () => {
    const walker = new AstWalker('test.ts');
    // Valid TypeScript but no defineSystem call — no patterns should be found.
    const source = `
      import { useQuery } from '@gwenjs/core';
      const result = useQuery([Position, Velocity]);
    `;
    const findings = walker.walk(source);
    expect(findings).toEqual([]);
  });
});

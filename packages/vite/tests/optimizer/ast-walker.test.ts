import { describe, it, expect } from "vitest";
import { AstWalker } from "../../src/optimizer/ast-walker";

const SYSTEM_CODE = `                                                                                                                                                                                                                                                                                                                                                                                                        
  import { useQuery, onUpdate, useComponent } from '@gwenjs/core/system'                                                                                                                                                                                                                                                                                                                                                       
  import { Position, Velocity } from './components'                                                                                                                                                                                                                                                                                                                                                                            
                                                                                                                                                                                                                                                                                                                                                                                                                               
  export const movementSystem = defineSystem(() => {                                                                                                                                                                                                                                                                                                                                                                         
    const entities = useQuery([Position, Velocity])                                                                                                                                                                                                                                                                                                                                                                            
                                                                                      
    onUpdate((dt) => {                                                                                                                                                                                                                                                                                                                                                                                                         
      for (const e of entities) {                                                                                                                                                                                                                                                                                                                                                                                              
        const pos = useComponent(e.id, Position)                                                                                                                                                                                                                                                                                                                                                                               
        const vel = useComponent(e.id, Velocity)                                   
        pos.x += vel.x * dt                                                                                                                                                                                                                                                                                                                                                                                                    
        pos.y += vel.y * dt                               
      }                                                                                                                                                                                                                                                                                                                                                                                                                        
    })                                                                                                                                                                                                                                                                                                                                                                                                                         
  })                                                               
  `;

describe("AstWalker", () => {
  it("detects a useQuery call and its component names", () => {
    const walker = new AstWalker("test.ts");
    const findings = walker.walk(SYSTEM_CODE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.queryComponents).toContain("Position");
    expect(findings[0]!.queryComponents).toContain("Velocity");
  });

  it("detects read components from 2-arg useComponent calls", () => {
    const walker = new AstWalker("test.ts");
    const findings = walker.walk(SYSTEM_CODE);
    expect(findings[0]!.readComponents).toContain("Position");
    expect(findings[0]!.readComponents).toContain("Velocity");
  });

  it("detects write components from proxy mutations", () => {
    const walker = new AstWalker("test.ts");
    const findings = walker.walk(SYSTEM_CODE);
    // pos.x += ... and pos.y += ... → Position is written
    expect(findings[0]!.writeComponents).toContain("Position");
    // vel is only read (RHS) — not written
    expect(findings[0]!.writeComponents).not.toContain("Velocity");
  });

  it("positions include writeTargets for mutated components", () => {
    const walker = new AstWalker("test.ts");
    const findings = walker.walk(SYSTEM_CODE);
    expect(findings[0]!.positions?.writeTargets).toContain("Position");
    expect(findings[0]!.positions?.writeTargets).not.toContain("Velocity");
  });

  it("positions include readDecls for useComponent declarations", () => {
    const walker = new AstWalker("test.ts");
    const findings = walker.walk(SYSTEM_CODE);
    const decls = findings[0]!.positions?.readDecls ?? [];
    expect(decls.some((d) => d.varName === "pos" && d.component === "Position")).toBe(true);
    expect(decls.some((d) => d.varName === "vel" && d.component === "Velocity")).toBe(true);
  });

  it("returns empty array for unparseable source", () => {
    const walker = new AstWalker("test.ts");
    const findings = walker.walk("useQuery(!!!invalid syntax @@@");
    expect(findings).toEqual([]);
  });

  it("returns empty array for source with no defineSystem", () => {
    const walker = new AstWalker("test.ts");
    const source = `                                                                                                                                                                                                                                                                                                                                                                                                         
        import { useQuery } from '@gwenjs/core/system';                                                                                                                                                                                                                                                                                                                                                                        
        const result = useQuery([Position, Velocity]);                                                                                                                                                                                                                                                                                                                                                                         
      `;
    const findings = walker.walk(source);
    expect(findings).toEqual([]);
  });

  it("does not detect 3-arg useComponent as a read", () => {
    const walker = new AstWalker("test.ts");
    const source = `
        export const s = defineSystem(() => {
          const entities = useQuery([Position])
          onUpdate(() => {
            for (const e of entities) {
              useComponent(e.id, Position, { x: 1 })
            }
          })
        })
      `;
    const findings = walker.walk(source);
    // 3-arg call is not detected as a read declaration
    expect(findings[0]!.readComponents).not.toContain("Position");
  });
});

// ── defineActor support ──────────────────────────────────────────────────────

const ACTOR_CODE = `
  import { defineActor } from '@gwenjs/core/actor'
  import { useQuery, onUpdate, useComponent } from '@gwenjs/core/system'
  import { Position, Velocity } from './components'

  export const SwarmActor = defineActor(SwarmPrefab, () => {
    const boids = useQuery([Position, Velocity])

    onUpdate(({ dt }) => {
      for (const e of boids) {
        const pos = useComponent(e, Position)
        const vel = useComponent(e, Velocity)
        pos.x += vel.x * dt
        pos.y += vel.y * dt
      }
    })
  })
`;

const ACTOR_WITH_NAME_CODE = `
  export const SwarmActor = defineActor('SwarmActor', SwarmPrefab, () => {
    const boids = useQuery([Position, Velocity])

    onUpdate(({ dt }) => {
      for (const e of boids) {
        const pos = useComponent(e, Position)
        pos.x += 1
      }
    })
  })
`;

const ACTOR_QUERY_CODE = `
  export const FlockActor = defineActor(FlockPrefab, () => {
    const members = useActorQuery(BoidActor, [Position, Velocity])

    onUpdate(({ dt }) => {
      for (const e of members) {
        const pos = useComponent(e, Position)
        const vel = useComponent(e, Velocity)
        pos.x += vel.x * dt
        pos.y += vel.y * dt
      }
    })
  })
`;

describe("AstWalker — defineActor support", () => {
  it("detects useQuery components inside a defineActor body", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_CODE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.queryComponents).toContain("Position");
    expect(findings[0]!.queryComponents).toContain("Velocity");
  });

  it("detects read components inside a defineActor onUpdate", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_CODE);
    expect(findings[0]!.readComponents).toContain("Position");
    expect(findings[0]!.readComponents).toContain("Velocity");
  });

  it("detects write components inside a defineActor onUpdate", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_CODE);
    expect(findings[0]!.writeComponents).toContain("Position");
    expect(findings[0]!.writeComponents).not.toContain("Velocity");
  });

  it("detects the pattern after name-transform (3-arg defineActor)", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_WITH_NAME_CODE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.queryComponents).toContain("Position");
    expect(findings[0]!.queryComponents).toContain("Velocity");
  });

  it("extracts positions.writeTargets correctly for actor patterns", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_CODE);
    expect(findings[0]!.positions?.writeTargets).toContain("Position");
    expect(findings[0]!.positions?.writeTargets).not.toContain("Velocity");
  });

  it("extracts positions.readDecls correctly for actor patterns", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_CODE);
    const decls = findings[0]!.positions?.readDecls ?? [];
    expect(decls.some((d) => d.varName === "pos" && d.component === "Position")).toBe(true);
    expect(decls.some((d) => d.varName === "vel" && d.component === "Velocity")).toBe(true);
  });

  it("returns empty array for a defineActor with no for-of loop (single-entity access)", () => {
    const walker = new AstWalker("actor.ts");
    const source = `
      export const HeroActor = defineActor(HeroPrefab, () => {
        const pos = useTransform()
        onUpdate(({ dt }) => {
          pos.x += speed * dt
        })
      })
    `;
    // No useQuery → no pattern
    const findings = walker.walk(source);
    expect(findings).toEqual([]);
  });
});

describe("AstWalker — useActorQuery support", () => {
  it("detects components from useActorQuery(Def, [A, B])", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_QUERY_CODE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.queryComponents).toContain("Position");
    expect(findings[0]!.queryComponents).toContain("Velocity");
  });

  it("detects read components when query source is useActorQuery", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_QUERY_CODE);
    expect(findings[0]!.readComponents).toContain("Position");
    expect(findings[0]!.readComponents).toContain("Velocity");
  });

  it("detects write components when query source is useActorQuery", () => {
    const walker = new AstWalker("actor.ts");
    const findings = walker.walk(ACTOR_QUERY_CODE);
    expect(findings[0]!.writeComponents).toContain("Position");
    expect(findings[0]!.writeComponents).not.toContain("Velocity");
  });

  it("detects useActorQuery inside a defineSystem body", () => {
    const walker = new AstWalker("system.ts");
    const source = `
      export const TrackingSystem = defineSystem((tracker) => {
        const targets = useActorQuery(EnemyActor, [Position])

        onUpdate(({ dt }) => {
          for (const e of targets) {
            const pos = useComponent(e, Position)
            pos.x += 1
          }
        })
      })
    `;
    const findings = walker.walk(source);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.queryComponents).toContain("Position");
  });
});

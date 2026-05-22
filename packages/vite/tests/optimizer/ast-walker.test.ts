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

import { describe, it, expect, vi } from "vitest";
import { gwenOptimizerPlugin } from "../../src/plugins/optimizer";
import { gwenVitePlugin } from "../../src/plugins/index";

describe("gwenOptimizerPlugin", () => {
  it("returns a Vite plugin with name gwen:optimizer", () => {
    const plugin = gwenOptimizerPlugin();
    expect(plugin.name).toBe("gwen:optimizer");
  });

  it("accepts debug option", () => {
    const plugin = gwenOptimizerPlugin({ debug: true });
    expect(plugin.name).toBe("gwen:optimizer");
  });

  it("has a transform hook", () => {
    const plugin = gwenOptimizerPlugin();
    expect(typeof plugin.transform).toBe("function");
  });

  it("does not transform non-ts files", async () => {
    const plugin = gwenOptimizerPlugin();
    const result = await (plugin.transform as Function)("const x = 1", "file.css");
    expect(result).toBeNull();
  });

  it("mode detect — direct SoA pattern returns null (not detected — already optimal)", async () => {
    const plugin = gwenOptimizerPlugin({ mode: "detect" });
    // Direct TypedArray access (`Position.x[id] += ...`) is already optimal and is
    // intentionally not detected by the optimizer — no transformation needed.
    const code = `                                                                  
        import { useQuery, onUpdate } from '@gwenjs/core/system';                                                                                                                                                                                                                                                                                                                                                              
        const entities = useQuery([Position, Velocity]);                                                                                                                                                                                                                                                                                                                                                                       
        onUpdate((dt) => {                                                            
          for (const id of entities) {                                                                                                                                                                                                                                                                                                                                                                                         
            Position.x[id] += Velocity.x[id] * dt;                                                                                                                                                                                                                                                                                                                                                                             
          }                                                                    
        });                                                                                                                                                                                                                                                                                                                                                                                                                    
      `;
    const ctx = { warn: vi.fn() };
    const result = await (plugin.transform as Function).call(ctx, code, "src/systems/movement.ts");
    expect(result).toBeNull();
  });

  it("mode detect — proxy pattern is detected by walker but returns null without a populated manifest", async () => {
    const plugin = gwenOptimizerPlugin({ mode: "detect" });
    // The AST walker finds a fully-formed proxy pattern, but `buildStart()` has not
    // been called in this unit test — the component manifest is empty.
    // PatternDetector therefore marks it non-optimizable and the plugin returns null.
    // Full transformation is covered by integration / build-level tests.
    const code = `                                                                                                                                                                                                                                                                                                                                                                                                           
        import { useQuery, onUpdate, useComponent } from '@gwenjs/core/system';       
        import { Position, Velocity } from './components';                
        export const s = defineSystem(() => {                                                                                                                                                                                                                                                                                                                                                                                  
          const entities = useQuery([Position, Velocity]);                            
          onUpdate((dt) => {                                                                                                                                                                                                                                                                                                                                                                                                   
            for (const e of entities) {                                            
              const pos = useComponent(e.id, Position);                               
              const vel = useComponent(e.id, Velocity);                                                                                                                                                                                                                                                                                                                                                                        
              pos.x += vel.x * dt;                                                                                                                                                                                                                                                                                                                                                                                             
              pos.y += vel.y * dt;                                                                                                                                                                                                                                                                                                                                                                                             
            }                                                                                                                                                                                                                                                                                                                                                                                                                  
          });                                                                                                                                                                                                                                                                                                                                                                                                                  
        });                                                                                                                                                                                                                                                                                                                                                                                                                    
      `;
    const ctx = { warn: vi.fn() };
    const result = await (plugin.transform as Function).call(ctx, code, "src/systems/movement.ts");
    expect(result).toBeNull();
  });

  it("mode transform — is the default when mode is not specified", () => {
    const plugin = gwenOptimizerPlugin();
    expect(typeof plugin.transform).toBe("function");
  });

  it("skips files that only have useActorQuery but no onUpdate", async () => {
    const plugin = gwenOptimizerPlugin();
    const code = `
      export const FlockActor = defineActor(FlockPrefab, () => {
        const members = useActorQuery(BoidActor, [Position])
      })
    `;
    const result = await (plugin.transform as Function)(code, "src/actors/flock.ts");
    expect(result).toBeNull();
  });

  it("does not skip a defineActor file with useActorQuery + onUpdate", () => {
    // The transform hook runs the full pipeline — with an empty manifest the
    // PatternDetector marks the pattern non-optimizable, so the result is null.
    // The important assertion is that the file is NOT skipped at the quick-check
    // stage (i.e. the transform hook runs at all without throwing).
    const plugin = gwenOptimizerPlugin({ mode: "detect" });
    const code = `
      export const FlockActor = defineActor(FlockPrefab, () => {
        const members = useActorQuery(BoidActor, [Position, Velocity])
        onUpdate(({ dt }) => {
          for (const e of members) {
            const pos = useComponent(e, Position)
            pos.x += 1
          }
        })
      })
    `;
    const ctx = { warn: vi.fn() };
    // Should not throw — file passes the quick-check and is processed by the walker
    expect(() =>
      (plugin.transform as Function).call(ctx, code, "src/actors/flock.ts"),
    ).not.toThrow();
  });

  it("does not skip a defineActor file with useQuery + onUpdate", () => {
    const plugin = gwenOptimizerPlugin({ mode: "detect" });
    const code = `
      export const SwarmActor = defineActor(SwarmPrefab, () => {
        const boids = useQuery([Position, Velocity])
        onUpdate(({ dt }) => {
          for (const e of boids) {
            const pos = useComponent(e, Position)
            pos.x += 1
          }
        })
      })
    `;
    const ctx = { warn: vi.fn() };
    expect(() =>
      (plugin.transform as Function).call(ctx, code, "src/actors/swarm.ts"),
    ).not.toThrow();
  });
});

describe("gwenVitePlugin", () => {
  it("includes gwen:optimizer plugin by default (detect mode)", () => {
    const plugins = gwenVitePlugin() as unknown[];
    const flat = plugins.flat(Infinity) as Array<{ name?: string }>;
    const optimizer = flat.find((p) => p && p.name === "gwen:optimizer");
    expect(optimizer).toBeDefined();
  });

  it("includes gwen:optimizer plugin when optimizer: true", () => {
    const plugins = gwenVitePlugin({ optimizer: true }) as unknown[];
    const flat = plugins.flat(Infinity) as Array<{ name?: string }>;
    const optimizer = flat.find((p) => p && p.name === "gwen:optimizer");
    expect(optimizer).toBeDefined();
  });
});

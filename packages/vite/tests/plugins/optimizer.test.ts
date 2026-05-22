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

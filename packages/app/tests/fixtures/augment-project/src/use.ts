import { defineConfig } from "@gwenjs/app";
import { createEngine } from "@gwenjs/core";

export async function useAugmentedContracts(): Promise<number> {
  const engine = await createEngine();
  const n: number = engine.inject("fixture:svc").n;
  engine.hooks.hook("game:over", (s) => {
    const x: number = s;
    return x;
  });
  defineConfig({ fixture: { level: 1 } });
  defineConfig({});
  return n;
}

import { createEngine } from "@gwenjs/core";

export async function wrongServiceType(): Promise<void> {
  const engine = await createEngine();
  const s: string = engine.inject("fixture:svc").n;
  void s;
}

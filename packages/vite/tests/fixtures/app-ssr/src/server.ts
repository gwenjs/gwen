import { createEngine } from "@gwenjs/core/node";

const engine = await createEngine({ variant: "light" });
await engine.startExternal();
await engine.advance(1 / 60);
console.log(`frames:${engine.frameCount}`);
await engine.stop();
process.exit(0);

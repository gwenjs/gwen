// Churn rooms that are dropped without dispose (no --expose-gc).
// Linux only: reads /proc/self/status.
import fs from "node:fs";
const { createGlue } = await import("./light/gwen_core_factory.js");
const mod = await WebAssembly.compile(fs.readFileSync("./light/gwen_core_bg.wasm"));
const N = Number(process.argv[2] ?? 2000);
let warned = 0;
const guard = new FinalizationRegistry((label) => {
  warned++;
  if (warned <= 1)
    console.error(
      `[GWEN dev] engine "${label}" was garbage-collected without stop(); call engine.stop() to release its wasm instance`,
    );
});
const vm = () =>
  Number(fs.readFileSync("/proc/self/status", "utf8").match(/VmSize:\s+(\d+)/)[1]) / 1048576;
let maxVm = 0,
  t = performance.now();
for (let i = 1; i <= N; i++) {
  try {
    const g = createGlue();
    g.initSync({ module: mod });
    const e = new g.Engine(100);
    e.create_entity();
    const room = { e };
    guard.register(room, `room-${i}`);
  } catch (x) {
    console.log(
      JSON.stringify({ failed_at: i, error: `${x.constructor.name}: ${x.message}`, maxVm }),
    );
    process.exit(0);
  }
  if (i % 50 === 0) {
    maxVm = Math.max(maxVm, vm());
    await new Promise((r) => setImmediate(r));
  }
}
console.log(
  JSON.stringify({
    survived: N,
    maxVm_gib: +maxVm.toFixed(0),
    ms: Math.round(performance.now() - t),
    guard_warnings: warned,
  }),
);

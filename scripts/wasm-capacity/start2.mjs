import fs from "node:fs";
const [variant, N, maxEnt = "10000"] = process.argv.slice(2);
const { createGlue } = await import(`./${variant}/gwen_core_factory.js`);
const bytes = fs.readFileSync(`./${variant}/gwen_core_bg.wasm`);
const rss0 = process.memoryUsage().rss;
let t0 = performance.now();
const mod = await WebAssembly.compile(bytes);
const compileMs = performance.now() - t0;
const rss1 = process.memoryUsage().rss;
const keep = [];
t0 = performance.now();
for (let i = 0; i < +N; i++) {
  const g = createGlue();
  const ex = g.initSync({ module: mod });
  const e = new g.Engine(+maxEnt);
  if (variant === "physics2d") e.physics_init(0, -9.81, +maxEnt);
  if (variant === "physics3d") e.physics3d_init(0, -9.81, 0, +maxEnt);
  keep.push([e, ex]);
}
const dt = performance.now() - t0;
const rss2 = process.memoryUsage().rss;
const mem = keep.reduce((a, [, ex]) => a + ex.memory.buffer.byteLength, 0);
console.log(
  JSON.stringify({
    variant,
    N: +N,
    compile_ms: +compileMs.toFixed(1),
    total_ms: +dt.toFixed(1),
    ms_per_room: +(dt / N).toFixed(3),
    rss_compile_mib: +((rss1 - rss0) / 1048576).toFixed(1),
    rss_rooms_mib: +((rss2 - rss1) / 1048576).toFixed(1),
    rss_per_room_mib: +((rss2 - rss1) / 1048576 / N).toFixed(2),
    linear_mem_per_room_mib: +(mem / N / 1048576).toFixed(2),
  }),
);

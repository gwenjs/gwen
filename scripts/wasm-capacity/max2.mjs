import fs from "node:fs";
const variant = process.argv[2] ?? "light";
const LIMIT = Number(process.argv[3] ?? 40000);
const STEP = Number(process.argv[4] ?? 1000);
const dir = new URL(`./${variant}/`, import.meta.url);
const { createGlue } = await import(new URL("gwen_core_factory.js", dir));
const mod = await WebAssembly.compile(fs.readFileSync(new URL("gwen_core_bg.wasm", dir)));
const st = () => {
  const s = fs.readFileSync("/proc/self/status", "utf8");
  const g = (k) => Number(s.match(new RegExp(k + ":\\s+(\\d+)"))[1]) / 1048576;
  return { vm: g("VmSize"), rss: g("VmRSS") };
};
const base = st();
const keep = [];
let prev = base,
  t = performance.now();
const out = {
  variant,
  arch: process.arch,
  node: process.version,
  flags: process.execArgv,
  base_vm_gib: +base.vm.toFixed(2),
  samples: [],
};
for (let i = 1; i <= LIMIT; i++) {
  try {
    const g = createGlue();
    const ex = g.initSync({ module: mod });
    keep.push([new g.Engine(100), ex]);
  } catch (e) {
    out.failed_at = i;
    out.error = `${e.constructor.name}: ${e.message}`;
    break;
  }
  if (i % STEP === 0) {
    const s = st();
    out.samples.push({
      i,
      vm_gib: +s.vm.toFixed(2),
      rss_mib: Math.round(s.rss * 1024),
      vm_per_inst_gib: +((s.vm - prev.vm) / STEP).toFixed(3),
      ms_per_inst: +((performance.now() - t) / STEP).toFixed(3),
    });
    prev = s;
    t = performance.now();
    if (process.env.PROG) console.error("prog", i, s.vm.toFixed(0), Math.round(s.rss * 1024));
  }
}
out.held = keep.length;
const s = st();
out.final_vm_gib = +s.vm.toFixed(1);
out.final_rss_mib = Math.round(s.rss * 1024);
out.vm_per_inst_gib_avg = +((s.vm - base.vm) / keep.length).toFixed(3);
const sm = out.samples;
out.samples = sm.length > 6 ? [...sm.slice(0, 2), sm[sm.length >> 1], ...sm.slice(-2)] : sm;
console.log(JSON.stringify(out));

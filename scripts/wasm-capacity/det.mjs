import fs from "node:fs";
import crypto from "node:crypto";
const STEPS = 600,
  N = 48,
  DT = 1 / 60;
const sha = (u8) => crypto.createHash("sha256").update(u8).digest("hex").slice(0, 16);
const inputs = Array.from({ length: STEPS }, (_, s) => ((s * 17) % 97) / 97);
const mods = {};
for (const v of ["physics2d", "physics3d"])
  mods[v] = await WebAssembly.compile(fs.readFileSync(`./${v}/gwen_core_bg.wasm`));
const { createGlue: g2 } = await import("./physics2d/gwen_core_factory.js");
const { createGlue: g3 } = await import("./physics3d/gwen_core_factory.js");
function room2d(G) {
  const ex = G.initSync({ module: mods.physics2d });
  const e = new G.Engine(256);
  e.physics_init(0, -9.81, 256);
  const ground = e.create_entity().index;
  e.physics_add_rigid_body(ground, 0, -1, 0, 1, 1, 0, 0, 0, 0);
  e.physics_add_box_collider(ground, 50, 1, 0, 0.5, 0, 1, 0xffff, 0xffff);
  const s = [];
  for (let i = 0; i < N; i++) {
    const id = e.create_entity().index;
    e.physics_add_rigid_body(id, (i % 8) * 1.1 - 4, 1 + (i >> 3) * 1.1, 1, 1, 1, 0.01, 0.01, 0, 0);
    if (i & 1) e.physics_add_ball_collider(id, 0.5, 0.2, 0.5, 0, 1, 0xffff, 0xffff);
    else e.physics_add_box_collider(id, 0.5, 0.5, 0.2, 0.5, 0, 1, 0xffff, 0xffff);
    s.push(id);
  }
  return {
    e,
    ex,
    step(k) {
      e.physics_apply_impulse(s[k % N], inputs[k] - 0.5, inputs[k]);
      e.physics_step(DT);
    },
    state() {
      const parts = s.flatMap((id) => [
        e.physics_get_position(id),
        e.physics_get_linear_velocity(id),
      ]);
      return Buffer.concat(parts.map((f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength)));
    },
  };
}
function room3d(G) {
  const ex = G.initSync({ module: mods.physics3d });
  const e = new G.Engine(256);
  e.physics3d_init(0, -9.81, 0, 256);
  const ground = e.create_entity().index;
  e.physics3d_add_body(ground, 0, -1, 0, 0, 1, 0, 0);
  e.physics3d_add_box_collider(ground, 50, 1, 50, 0, 0, 0, false, 0.5, 0, 0xffff, 0xffff, 0);
  const s = [];
  for (let i = 0; i < N; i++) {
    const id = e.create_entity().index;
    e.physics3d_add_body(
      id,
      (i % 4) * 1.1 - 2,
      1 + (i >> 4) * 1.1,
      ((i >> 2) % 4) * 1.1 - 2,
      1,
      1,
      0.01,
      0.01,
    );
    if (i & 1)
      e.physics3d_add_sphere_collider(id, 0.5, 0, 0, 0, false, 0.5, 0.2, 0xffff, 0xffff, 0);
    else
      e.physics3d_add_box_collider(id, 0.5, 0.5, 0.5, 0, 0, 0, false, 0.5, 0.2, 0xffff, 0xffff, 0);
    s.push(id);
  }
  return {
    e,
    ex,
    step(k) {
      e.physics3d_set_linear_velocity?.(s[k % N], inputs[k] - 0.5, inputs[k], 0);
      e.physics3d_step(DT);
    },
    state() {
      return Buffer.concat(
        s.map((id) => {
          const f = e.physics3d_get_body_state(id);
          return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
        }),
      );
    },
  };
}
const res = {};
for (const [v, mk, gl, orig] of [
  ["physics2d", room2d, g2, "./physics2d/gwen_core.js"],
  ["physics3d", room3d, g3, "./physics3d/gwen_core.js"],
]) {
  const r = {};
  const A = mk(gl()),
    B = mk(gl());
  r.before_moved = sha(A.state());
  // keep A and B call histories identical: mem_A === mem_B is part of all_equal
  sha(B.state());
  for (let k = 0; k < STEPS; k++) A.step(k);
  for (let k = 0; k < STEPS; k++) B.step(k);
  r.A_alone = sha(A.state());
  r.B_alone = sha(B.state());
  r.mem_A = sha(new Uint8Array(A.ex.memory.buffer));
  r.mem_B = sha(new Uint8Array(B.ex.memory.buffer));
  const C = mk(gl()),
    D = mk(gl());
  for (let k = 0; k < STEPS; k++) {
    C.step(k);
    D.step(k);
  }
  r.C_interleaved = sha(C.state());
  r.D_interleaved = sha(D.state());
  const O = await import(orig);
  const S = mk(O);
  for (let k = 0; k < STEPS; k++) S.step(k);
  r.shared_singleton = sha(S.state());
  const e1 = mk(O),
    e2 = mk(O);
  r.note_shared_two = "singleton initSync re-called: same instance? " + (e1.ex === S.ex);
  for (let k = 0; k < STEPS; k++) {
    e1.step(k);
    e2.step(k);
  }
  r.shared_two_e1 = sha(e1.state());
  r.shared_two_e2 = sha(e2.state());
  const sample = A.state();
  // same paired read as before_moved
  B.state();
  r.sample_first_body_y = new Float32Array(sample.buffer, sample.byteOffset, 4)[1];
  r.all_equal =
    new Set([
      r.A_alone,
      r.B_alone,
      r.C_interleaved,
      r.D_interleaved,
      r.shared_singleton,
      r.shared_two_e1,
      r.shared_two_e2,
    ]).size === 1 && r.mem_A === r.mem_B;
  r.moved = r.before_moved !== r.A_alone;
  res[v] = r;
}
console.log(JSON.stringify(res));

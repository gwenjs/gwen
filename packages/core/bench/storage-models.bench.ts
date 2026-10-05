/**
 * Storage model benchmark. Reference scene: internals-docs/adr/0001-component-storage.md
 *
 * `today` uses a real createEngine. Engines are stopped in afterAll.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, bench, describe } from "vitest";
import {
  DT,
  ModelA,
  ModelB,
  ModelC,
  STORAGE_REFERENCE_SCENE,
  TodayModel,
  runFrame,
  type StorageModel,
} from "./storage-models/models";

const ITER = { time: 200, iterations: 10, warmupTime: 50, warmupIterations: 5 };
const STRUCT = { time: 0, iterations: 30, warmupTime: 0, warmupIterations: 5 };

const engines: TodayModel[] = [];
const byteRows: { model: string; e: number; bytes: number }[] = [];

function remember(model: string, count: number, bytes: number): void {
  byteRows.push({ model, e: count, bytes });
}

afterAll(async () => {
  try {
    const path = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../target/storage-bench-bytes-js.json",
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ runtime: "js", rows: byteRows }));
  } finally {
    for (const engine of engines) {
      await engine.stop();
    }
  }
});

function benchModel(label: string, count: number, create: () => StorageModel): void {
  describe(label, () => {
    const iterModel = create();
    const addModel = create();
    const removeModel = create();
    const frameModel = create();
    let addCursor = 0;
    let removeCursor = 0;
    let frame = 0;
    bench(
      `${label}/E${count}/iter`,
      () => {
        iterModel.movement(DT);
      },
      ITER,
    );
    bench(
      `${label}/E${count}/add`,
      () => {
        if (addCursor >= count / 2) {
          throw new Error(`${label} add bench exhausted E=${count}`);
        }
        addModel.addHealth(addCursor * 2 + 1);
        addCursor += 1;
      },
      STRUCT,
    );
    bench(
      `${label}/E${count}/remove`,
      () => {
        if (removeCursor >= count / 2) {
          throw new Error(`${label} remove bench exhausted E=${count}`);
        }
        removeModel.removeHealth(removeCursor * 2);
        removeCursor += 1;
      },
      STRUCT,
    );
    bench(
      `${label}/E${count}/frame`,
      () => {
        if (frame >= 80) throw new Error(`${label} frame bench exhausted E=${count}`);
        runFrame(frameModel, frame, DT);
        frame += 1;
      },
      STRUCT,
    );
  });
}

// Vitest benchmark mode does not run beforeAll. Build the real engines before bench() runs.
const todayReady = new Map<
  number,
  {
    iter: TodayModel;
    add: TodayModel;
    remove: TodayModel;
    frame: TodayModel;
  }
>();

for (const count of STORAGE_REFERENCE_SCENE) {
  const iter = await TodayModel.build(count);
  const add = await TodayModel.build(count);
  const remove = await TodayModel.build(count);
  const frame = await TodayModel.build(count);
  engines.push(iter, add, remove, frame);
  remember("today", count, iter.heapBytes());
  todayReady.set(count, { iter, add, remove, frame });
}

for (const count of STORAGE_REFERENCE_SCENE) {
  const today = todayReady.get(count);
  if (today === undefined) throw new Error(`today bundle missing E=${count}`);
  describe(`storage E=${count}`, () => {
    const packed = new ModelA(count);
    const sparse = new ModelB(count);
    const chunked = new ModelC(count);
    remember("A", count, packed.heapBytes());
    remember("B", count, sparse.heapBytes());
    remember("C", count, chunked.heapBytes());
    benchModel("A", count, () => new ModelA(count));
    benchModel("B", count, () => new ModelB(count));
    benchModel("C", count, () => new ModelC(count));

    describe("today", () => {
      let addCursor = 0;
      let removeCursor = 0;
      let frame = 0;
      bench(
        `today/E${count}/iter`,
        () => {
          today.iter.movement(1 / 60);
        },
        ITER,
      );
      bench(
        `today/E${count}/add`,
        () => {
          if (addCursor >= count / 2) throw new Error(`today add bench exhausted E=${count}`);
          today.add.addHealth(addCursor * 2 + 1);
          addCursor += 1;
        },
        STRUCT,
      );
      bench(
        `today/E${count}/remove`,
        () => {
          if (removeCursor >= count / 2) throw new Error(`today remove bench exhausted E=${count}`);
          today.remove.removeHealth(removeCursor * 2);
          removeCursor += 1;
        },
        STRUCT,
      );
      bench(
        `today/E${count}/frame`,
        () => {
          if (frame >= 80) throw new Error(`today frame bench exhausted E=${count}`);
          runFrame(today.frame, frame, 1 / 60);
          frame += 1;
        },
        STRUCT,
      );
    });
  });
}

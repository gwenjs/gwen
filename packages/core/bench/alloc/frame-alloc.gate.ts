import { expect, test } from "vitest";

import thresholdsFile from "../alloc-thresholds.json" with { type: "json" };
import { evaluateAllocGate, parseAllocThresholds } from "./evaluate-alloc-gate";
import { readAllocSink } from "./scenarios";
import { eachAllocPath, measurePath, runningNodeMajor } from "./run-path";

const thresholds = parseAllocThresholds(thresholdsFile);

test("every alloc path stays within its recorded threshold", async () => {
  const nodeMajor = runningNodeMajor();
  const measured = [];
  for (const path of eachAllocPath()) {
    const row = await measurePath(path, thresholds);
    measured.push(row);
    // eslint-disable-next-line no-console -- the gate prints each measured path
    console.log(`[ALLOC SAMPLE] ${JSON.stringify(row)}`);
  }
  const report = evaluateAllocGate(measured, thresholds, nodeMajor);
  // eslint-disable-next-line no-console -- the gate prints the pass/fail report
  console.log(`[ALLOC REPORT] ${JSON.stringify(report)}`);
  expect(readAllocSink()).toEqual(expect.any(Number));
  expect(report.verdict).toBe("pass");
});

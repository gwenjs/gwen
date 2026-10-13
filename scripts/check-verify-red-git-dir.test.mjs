import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workTreeError = "this operation must be run in a work tree";

test("verify-red.sh ignores a hook GIT_DIR", () => {
  const decoy = mkdtempSync(join(tmpdir(), "gwen-verify-red-decoy-"));
  try {
    const result = spawnSync("bash", ["scripts/verify-red.sh"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
      env: {
        ...process.env,
        GIT_DIR: decoy,
        GIT_TERMINAL_PROMPT: "0",
        VERIFY_RED_GIT_DIR_CHECK: "1",
      },
    });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const brief = text
      .split("\n")
      .filter((line) => line.includes("fatal:") || line.includes("verify-red:"))
      .join("\n");
    assert.equal(text.includes(workTreeError), false, brief);
    assert.equal(result.status, 0, brief);
    assert.equal(text.includes("verify-red: git toplevel ok"), true, brief);
  } finally {
    rmSync(decoy, { recursive: true, force: true });
  }
});

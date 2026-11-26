import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_URL = "http://127.0.0.1:4180/";

/** Poll until the preview answers, the child exits, or 100 attempts pass. Never throws. */
async function waitForServer(child: ChildProcess): Promise<boolean> {
  let exited = child.exitCode !== null;
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", () => {
    exited = true;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited || child.exitCode !== null) return false;
    try {
      const response = await fetch(SERVER_URL, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && child.exitCode === null) return true;
    } catch {
      // The preview is not listening yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
  return false;
}

export default async function globalSetup(): Promise<() => void> {
  const exampleDir = path.dirname(fileURLToPath(import.meta.url));
  const child = spawn(
    process.execPath,
    [path.resolve(exampleDir, "../../_harness/run.mjs"), "platformer-2d", "preview"],
    {
      cwd: path.resolve(exampleDir, ".."),
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, PORT: "4180" },
    },
  );
  const reachable = await waitForServer(child);
  process.env["GWEN_EXAMPLE_SERVER"] = JSON.stringify({ reachable, url: SERVER_URL });
  return () => {
    child.kill();
  };
}

import { execFile } from "node:child_process";

const MAX_BUFFER = 256 * 1024 * 1024;

/** Repo-locating variables. With `GIT_DIR` set, git uses that repository and not the one `-C <root>` would find. */
const SCRUBBED = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
] as const;

export type BaseLockfile =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly kind: "unresolved"; readonly detail: string }
  | { readonly ok: false; readonly kind: "missing" }
  | { readonly ok: false; readonly kind: "unavailable"; readonly code: string };

/**
 * `git -C <root> show <ref>:./pnpm-lock.yaml`.
 * git 2.54.0, `GIT_*` unset, exit 128: a bad ref prints `fatal: invalid object name '<ref>'.`;
 * a missing lockfile prints `fatal: path '<repo-relative>pnpm-lock.yaml' …` (`LC_ALL=C`).
 */
export function readBaseLockfile(root: string, ref: string): Promise<BaseLockfile> {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  for (const key of SCRUBBED) delete env[key];
  delete env.LANGUAGE;
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "show", `${ref}:./pnpm-lock.yaml`],
      { env, encoding: "utf8", maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, text: stdout });
          return;
        }
        const code = "code" in error ? error.code : undefined;
        if (typeof code === "string") {
          resolve({ ok: false, kind: "unavailable", code });
          return;
        }
        const raw = stderr.split("\n", 1)[0] ?? "";
        const detail = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (missingPath(detail)) {
          resolve({ ok: false, kind: "missing" });
          return;
        }
        resolve({ ok: false, kind: "unresolved", detail });
      },
    );
  });
}

function missingPath(line: string): boolean {
  return /^fatal: path '(?:.*\/)?pnpm-lock\.yaml' (?:does not exist in|exists on disk, but not in) '/.test(
    line,
  );
}

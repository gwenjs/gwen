import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import { indexJson, isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

const PROBLEMS_URL =
  "https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems";
/** Resolutions the `esm-only` profile ignores. */
const IGNORED_RESOLUTIONS: readonly string[] = ["node10", "node16-cjs"];

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why the process could not start (`ENOENT` when the command is absent), if it did not. */
  readonly spawnError: string | undefined;
}

/**
 * Runs a command with its stdout in the file `name` of `scratch`, not in a pipe: attw calls
 * `process.exit` right after it writes, and a pipe drops what is still buffered (macOS cuts
 * stdout at 64 KiB).
 */
async function run(
  file: string,
  args: readonly string[],
  cwd: string,
  scratch: string,
  name: string,
): Promise<Run> {
  const stdoutPath = path.join(scratch, name);
  const handle = await open(stdoutPath, "w");
  try {
    const ended = await new Promise<Omit<Run, "stdout">>((resolve) => {
      const child = spawn(file, [...args], { cwd, stdio: ["ignore", handle.fd, "pipe"] });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        resolve({ code: null, stderr, spawnError: error.code ?? error.message });
      });
      child.on("close", (code) => {
        resolve({ code, stderr, spawnError: undefined });
      });
    });
    return { ...ended, stdout: await readFile(stdoutPath, "utf8") };
  } finally {
    await handle.close();
  }
}

function attwFinding(
  message: string,
  hint: string,
  context: PackageContext,
  entrypoint?: string,
): ConformanceFinding {
  const index = indexJson(context.text);
  const keyPath = entrypoint === undefined ? ["exports"] : ["exports", entrypoint];
  return {
    code: ConformanceErrorCodes.ATTW,
    message,
    hint,
    file: "package.json",
    line: index.keyLine(keyPath) ?? 1,
  };
}

/**
 * The first line of the output that explains a failure; when it ends with `:` (attw prints
 * `error while checking file:` and the cause on the next line), the next line follows it.
 */
function reason(output: Run): string {
  const lines = (output.stderr.trim() || output.stdout.trim())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [first = "", next] = lines;
  const text = first.endsWith(":") && next !== undefined ? `${first} ${next}` : first;
  if (text.length > 0) return text;
  return output.spawnError === undefined
    ? `exit code ${String(output.code)}`
    : `the command could not start (${output.spawnError})`;
}

/** `attw --pack --profile esm-only` on the tarball `npm pack` makes of the package. */
export async function checkAttw(context: PackageContext): Promise<readonly ConformanceFinding[]> {
  const bin = path.join(
    path.dirname(createRequire(import.meta.url).resolve("@arethetypeswrong/cli/package.json")),
    "dist/index.js",
  );
  const scratch = await mkdtemp(path.join(tmpdir(), "gwen-conformance-attw-"));
  try {
    const packed = await run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
      context.root,
      scratch,
      "pack.json",
    );
    const filename = packed.code === 0 ? tarballName(packed.stdout) : undefined;
    if (filename === undefined) {
      return [attwFinding(`npm pack failed: ${reason(packed)}`, "Make npm pack succeed.", context)];
    }
    const checked = await run(
      process.execPath,
      [
        bin,
        path.join(scratch, filename),
        "--profile",
        "esm-only",
        "--format",
        "json",
        "--no-color",
      ],
      // Not the package root: attw reads `./.attw.json` from its cwd, and a package must not
      // be able to exclude its own entry points from the check.
      scratch,
      scratch,
      "attw.json",
    );
    return problemsOf(checked, context);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function tarballName(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    return isRecord(first) && typeof first.filename === "string" ? first.filename : undefined;
  } catch {
    return undefined;
  }
}

/** What a problem is about: an entry point, or the file that attw names. */
function subjectOf(problem: Record<string, unknown>): string | undefined {
  if (typeof problem.entrypoint === "string") return `at ${JSON.stringify(problem.entrypoint)}`;
  const file = [problem.typesFileName, problem.implementationFileName, problem.fileName].find(
    (name) => typeof name === "string",
  );
  return typeof file === "string" ? `in ${JSON.stringify(withoutPackagePrefix(file))}` : undefined;
}

/** `/node_modules/<name>/dist/a.js` -> `dist/a.js`: attw names files inside its virtual install. */
function withoutPackagePrefix(file: string): string {
  return file.replace(/^\/node_modules\/(?:@[^/]+\/)?[^/]+\//, "");
}

function problemsOf(checked: Run, context: PackageContext): ConformanceFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(checked.stdout);
  } catch {
    return [attwFinding(`attw failed: ${reason(checked)}`, "Run attw --pack locally.", context)];
  }
  const analysis = isRecord(parsed) ? parsed.analysis : undefined;
  if (isRecord(analysis) && !analysis.types) {
    return [attwFinding("the package ships no TypeScript types", "Ship .d.ts files.", context)];
  }
  if (!isRecord(analysis) || !Array.isArray(analysis.problems)) {
    return [attwFinding("attw printed an unexpected report", "Run attw --pack locally.", context)];
  }
  const groups = new Map<
    string,
    { kind: string; subject: string; entrypoint: string | undefined; resolutions: string[] }
  >();
  const problems: unknown[] = analysis.problems;
  for (const problem of problems) {
    if (!isRecord(problem)) continue;
    const { kind, entrypoint, resolutionKind } = problem;
    if (typeof kind !== "string") continue;
    if (typeof resolutionKind === "string" && IGNORED_RESOLUTIONS.includes(resolutionKind))
      continue;
    const subject = subjectOf(problem) ?? "in the package";
    const key = `${kind} ${subject}`;
    const group = groups.get(key) ?? {
      kind,
      subject,
      entrypoint: typeof entrypoint === "string" ? entrypoint : undefined,
      resolutions: [],
    };
    if (typeof resolutionKind === "string") group.resolutions.push(resolutionKind);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const where = group.resolutions.length > 0 ? ` (${group.resolutions.join(", ")})` : "";
    return attwFinding(
      `${group.kind} ${group.subject}${where}`,
      `See ${PROBLEMS_URL}/${group.kind}.md`,
      context,
      group.entrypoint,
    );
  });
}

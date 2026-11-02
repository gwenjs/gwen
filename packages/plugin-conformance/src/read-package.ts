import { readFile } from "node:fs/promises";
import path from "node:path";

export type PackageRead =
  | { readonly ok: true; readonly text: string; readonly manifest: unknown }
  | { readonly ok: false; readonly reason: "missing" | "invalid" | "unreadable" };

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

/** Read and parse `package.json` once. A bad file becomes a reason, not a throw. */
export async function readPackageJson(root: string): Promise<PackageRead> {
  const file = path.join(root, "package.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") return { ok: false, reason: "missing" };
    return { ok: false, reason: "unreadable" };
  }
  try {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const manifest: unknown = JSON.parse(text);
    return { ok: true, text, manifest };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

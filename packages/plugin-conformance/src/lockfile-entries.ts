/** One third-party package. `line` is the first key of that name, in file order. */
export interface LockfilePackage {
  readonly versions: readonly string[];
  readonly line: number;
}

/** `lockfileVersion` with quotes stripped, or `"none"` when the line is absent. */
export function lockfileVersion(text: string): string {
  for (const line of splitLines(text)) {
    if (!line.startsWith("lockfileVersion:")) continue;
    const token = line.slice("lockfileVersion:".length).trim().split(/\s+/, 1)[0];
    if (token === undefined || token.length === 0) return "none";
    return unquote(token);
  }
  return "none";
}

/** Third-party `packages:` and `snapshots:` keys. `@gwenjs/` is skipped; the version stops at `(`. */
export function lockfileEntries(text: string): Map<string, LockfilePackage> {
  const entries = new Map<string, LockfilePackage>();
  let open = false;
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const head = line[0];
    if (head !== undefined && head !== " " && head !== "\t") {
      open = line === "packages:" || line === "snapshots:";
      continue;
    }
    if (!open || !/^ {2}\S/.test(line)) continue;
    const parsed = parseKey(line.slice(2));
    if (parsed === undefined || parsed.name.startsWith("@gwenjs/")) continue;
    const found = entries.get(parsed.name);
    entries.set(parsed.name, {
      versions: found === undefined ? [parsed.version] : [...found.versions, parsed.version],
      line: found === undefined ? index + 1 : found.line,
    });
  }
  return entries;
}

function splitLines(text: string): readonly string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function parseKey(key: string): { readonly name: string; readonly version: string } | undefined {
  let bare = key.endsWith(": {}") ? key.slice(0, -4) : key.endsWith(":") ? key.slice(0, -1) : key;
  bare = unquote(bare);
  const at = bare.indexOf("@", 1);
  if (at < 1) return undefined;
  const rest = bare.slice(at + 1);
  const paren = rest.indexOf("(");
  const version = paren >= 0 ? rest.slice(0, paren) : rest;
  return { name: bare.slice(0, at), version };
}

function unquote(raw: string): string {
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (first === undefined || last === undefined || first !== last) return raw;
  if (first !== "'" && first !== '"') return raw;
  return raw.slice(1, -1);
}

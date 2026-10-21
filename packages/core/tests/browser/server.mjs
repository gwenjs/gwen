// Static server for the browser tests. No dependency.
// `/` serves tests/browser/site/, `/wasm/` serves packages/core/wasm/.
// Every response under `/csp/` carries the CSP under test.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "site");
const wasmRoot = resolve(here, "../../wasm");
const PORT = 4178;
export const CSP = "script-src 'self' 'wasm-unsafe-eval'";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

/** Map a request path to a file inside one of the two roots, or null. */
export function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const [root, rel] = decoded.startsWith("/wasm/")
    ? [wasmRoot, decoded.slice("/wasm/".length)]
    : [siteRoot, decoded.slice(1)];
  let file = resolve(root, rel);
  if (file !== root && !file.startsWith(root + sep)) return null;
  if (decoded.endsWith("/")) file = join(file, "index.html");
  return file;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const file = resolveFile(pathname);
  const headers = { "Cache-Control": "no-store" };
  if (pathname.startsWith("/csp/")) headers["Content-Security-Policy"] = CSP;
  try {
    if (file === null || !(await stat(file)).isFile()) throw new Error("not found");
    const body = await readFile(file);
    res.writeHead(200, {
      ...headers,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, headers);
    res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1");

/**
 * Dev hint for Node-side Vite code.
 * `packages/vite/src` reads `process.env["NODE_ENV"]`, not `__GWEN_DEV__`
 * (`packages/vite/src/scanners/index.ts:162`).
 */
export function devHint(hint: string): string | undefined {
  return process.env["NODE_ENV"] !== "production" ? hint : undefined;
}

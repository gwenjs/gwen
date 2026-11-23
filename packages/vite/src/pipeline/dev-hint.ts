/**
 * Dev hint for Node-side Vite code.
 * `packages/vite/src` reads `process.env["NODE_ENV"]`, not `__GWEN_DEV__`
 * (`packages/vite/src/optimizer/code-generator.ts:6-8`).
 */
export function devHint(hint: string): string | undefined {
  return process.env["NODE_ENV"] !== "production" ? hint : undefined;
}

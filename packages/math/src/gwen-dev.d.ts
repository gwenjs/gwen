/**
 * Build-time flag for this package's own typecheck.
 * Not imported, and excluded from the published `.d.ts` rollup: schema already
 * declares the same `const` for every program that loads both packages.
 * A second `declare global` in `errors.ts` clashes with schema when one program
 * loads both packages, so the flag stays in this file, which only the math program includes.
 */
declare const __GWEN_DEV__: boolean;

# @selftest/plugin

Fixture plugin of the gwen CI job `plugin-conformance-selftest`. The job calls
`.github/workflows/plugin-conformance.yml` on this directory with the stack tarballs of the same
run, so every pull request proves the reusable workflow end to end.

- `.` exports `SelftestPlugin`, a plugin with an empty setup.
- `./module` exports a default module that adds `SelftestPlugin`.

`pnpm-workspace.yaml` and `vitest.config.mjs` keep pnpm and vitest inside this directory: without
them they use the gwen root workspace and its vitest config. A plugin repository does not need them.

`pnpm-lock.yaml` is the base of `gwen-conformance check --lockfile-base HEAD`. A pull request that
adds a third-party dependency to `packages/plugin-conformance` regenerates it. From the gwen root
`<repo>`, with a scratch directory `<dir>`:

1. `pnpm build:ts && node scripts/stack/pack.mjs --out <dir>`
2. From a directory with no `.npmrc` (a stale one breaks `npm publish`):
   `node <repo>/scripts/stack/registry.mjs run --out <dir> --satellite <repo>/.github/selftest/plugin --cmd true`
3. The harness stamps `package.json` and writes `.npmrc` and `node_modules`. Back in `<repo>`:
   `git checkout .github/selftest/plugin/package.json`, then
   `rm -rf .github/selftest/plugin/.npmrc .github/selftest/plugin/node_modules`.
4. Commit only `.github/selftest/plugin/pnpm-lock.yaml`.

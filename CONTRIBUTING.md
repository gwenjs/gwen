# Contributing

## Setup

This repository uses pnpm.

```sh
pnpm install
```

TypeScript packages typecheck against built declarations. Build them before typecheck and tests:

```sh
pnpm build:ts
```

## Workflow

Open pull requests against `v1-alpha`. Do not open them against `main`.

Use a [Conventional Commit](https://www.conventionalcommits.org/) subject. Do not add `Co-authored-by`, `Generated-by`, or any other AI or tool trailer.

Do not commit `docs/superpowers/`. Specs and plans stay local.

Report security issues privately. See [SECURITY.md](SECURITY.md).

This project follows the Contributor Covenant. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Quality gate

These commands must pass before a change is ready:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

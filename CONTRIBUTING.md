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

## Quality gate

These commands must pass before a change is ready:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

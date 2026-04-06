# GWEN Engine Internal Documentation

This directory contains documentation for contributors working on the GWEN engine itself — not for end users.

## Quick Links

- **[Architecture Overview](./architecture.md)** — Two-layer design, package structure, key decisions
- **[Contributing Guide](./contributing.md)** — Setup, build commands, commit conventions, release process
- **[WASM & Crate Builds](./crate-builds.md)** — Rust/WASM variants, build process, output locations

## Quick Start

```bash
# Clone and install
git clone https://github.com/gwenjs/gwen
cd gwen
pnpm install

# Build TypeScript packages
pnpm build:ts

# Build WASM (requires Rust + wasm-pack)
pnpm build:wasm

# Run tests
pnpm test

# Run linter
pnpm lint

# TypeScript type checking
pnpm typecheck
```

## Next Steps

1. Read [Architecture Overview](./architecture.md) to understand the system design
2. Follow [Contributing Guide](./contributing.md) for detailed setup and workflows
3. Check [WASM & Crate Builds](./crate-builds.md) if working with Rust code

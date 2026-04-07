# Local Registry (Verdaccio)

The GWEN ecosystem is split across multiple repositories (`gwenjs/gwen`, `gwenjs/cli`, and future plugin repos). During local development, these repos need to consume `@gwenjs/*` packages from each other without waiting for a real npm publish.

Verdaccio acts as a local npm registry proxy. It serves `@gwenjs/*` packages from local builds while forwarding everything else to the real npm registry.

---

## One-time Setup

**Install Verdaccio globally:**

```bash
npm install -g verdaccio
```

**Create a local `.npmrc`** at the root of each repo that consumes `@gwenjs/*` packages (this file is gitignored):

```ini
@gwenjs:registry=http://localhost:4873
//localhost:4873/:_authToken=local-dev
```

The token value is arbitrary — Verdaccio is configured to allow anonymous publishing for `@gwenjs/*`.

---

## Daily Workflow

**Start the registry** (once per dev session, from the `gwen` repo root):

```bash
pnpm verdaccio:start
```

This starts Verdaccio on `http://localhost:4873` using the project config in `verdaccio.yaml`.

**Publish packages after making changes:**

```bash
pnpm verdaccio:publish
```

This script:
1. Clears the `@gwenjs` namespace from the local registry storage
2. Builds all `@gwenjs/*` packages (failures on individual packages are non-fatal)
3. Publishes all packages to Verdaccio with `--force`

**Install in a consumer repo** (cli, plugin, etc.):

```bash
pnpm install
```

pnpm resolves `@gwenjs/*` from Verdaccio, everything else from npm.

---

## Cross-repo Development

When you are working on `gwen` and a consumer repo at the same time:

```bash
# In gwenjs/gwen — after changing a package
pnpm verdaccio:publish

# In gwenjs/cli (or a plugin repo)
pnpm install   # picks up the new version
```

No symlinks, no workspace hacks. The loop takes a few seconds.

---

## Configuration

**`verdaccio.yaml`** (project root) configures the local registry:

- `@gwenjs/*` packages: anonymous publish and access, proxy to npm as fallback
- All other packages: proxy to npm, publish requires auth

**`scripts/verdaccio-publish.sh`** runs the full publish pipeline. It clears the registry storage before publishing so the same version can be re-published freely during development.

**Storage** defaults to `~/.local/share/verdaccio/storage`. Override with the `VERDACCIO_STORAGE` environment variable if needed.

---

## Setting Up a New Consumer Repo

Any new repo that depends on `@gwenjs/*` (plugin, tool, etc.) needs:

1. A `.npmrc` file at its root (gitignored):
   ```ini
   @gwenjs:registry=http://localhost:4873
   //localhost:4873/:_authToken=local-dev
   ```
2. Add `.npmrc` to `.gitignore`

That's it. Once Verdaccio is running and `pnpm verdaccio:publish` has been run, `pnpm install` in the new repo will resolve all `@gwenjs/*` packages locally.

---

## CI

CI never uses Verdaccio. Each repo's CI resolves `@gwenjs/*` from the public npm registry. Consumer repos should not be pushed until their `@gwenjs/*` dependencies are published on npm.

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

This command:
1. Builds the `@gwenjs/*` packages (`pnpm build:ts`)
2. Packs them into `stack/` (`node scripts/stack/pack.mjs --out stack`)
3. Publishes that directory to the local registry (`node scripts/stack/registry.mjs publish --out stack`)

Each `pnpm verdaccio:publish` registers one throw-away user in the registry's htpasswd (`./.verdaccio/htpasswd`, `auth.htpasswd.file` in `verdaccio.yaml`). Delete that file to reset.

**Install in a consumer repo** (cli, plugin, etc.):

Install the exact stamp from `stack/stack-manifest.json`, or the dist-tag `integration`. Other packages still come from npm.

---

## Cross-repo Development

When you are working on `gwen` and a consumer repo at the same time:

```bash
# In gwenjs/gwen — after changing a package
pnpm verdaccio:publish
```

Read the stamp from `stack/stack-manifest.json` (`version`). It is `1.0.0-integration.<UTC yyyymmddHHMMSS>.g<sha7>`. Publish sets the dist-tag `integration`.

In the consumer repo, install that exact stamp or the tag:

```bash
pnpm add @gwenjs/core@integration
```

A `0.x` range does not select this stamp.

---

## Configuration

**`verdaccio.yaml`** (project root) configures the local registry:

- `@gwenjs/*` packages: anonymous publish and access, no proxy to npm
- All other packages: proxy to npm, publish requires auth

**`scripts/stack/pack.mjs`** writes `stack/stack-manifest.json` and the tarballs. **`scripts/stack/registry.mjs`** `publish` sends those tarballs to the local registry. This command does not clear registry storage.

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

That's it. Once Verdaccio is running and `pnpm verdaccio:publish` has been run, install the stamp from `stack/stack-manifest.json` or the dist-tag `integration`. A `0.x` range does not select that stamp.

---

## CI

CI never uses Verdaccio. The job `stack-pack` packs the framework into the `stack-tarballs` artifact. It does not publish to a registry and it does not run satellites. Each repo's CI resolves `@gwenjs/*` from the public npm registry. Consumer repos should not be pushed until their `@gwenjs/*` dependencies are published on npm.

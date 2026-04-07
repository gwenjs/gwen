# Changelog


## Gwen v0.1.0 - 2024-06-30


### 🚀 Enhancements

- **core:** Add @gwenjs/core/system entry point ([80b743f](https://github.com/gwenjs/gwen/commit/80b743f))
- **core:** Add @gwenjs/core/actor entry point ([5862e73](https://github.com/gwenjs/gwen/commit/5862e73))
- **core:** Wire package.json exports and tsconfig paths for subpaths ([3d79224](https://github.com/gwenjs/gwen/commit/3d79224))
- **kit:** Add @gwenjs/kit/module entry point ([d91cf9c](https://github.com/gwenjs/gwen/commit/d91cf9c))
- **kit:** Add @gwenjs/kit/plugin entry point ([2154b69](https://github.com/gwenjs/gwen/commit/2154b69))
- **core,kit:** Scoped subpath exports for @gwenjs/core and @gwenjs/kit ([5e9445e](https://github.com/gwenjs/gwen/commit/5e9445e))
- **core:** Add useHook and onCleanup composables with universal auto-cleanup ([d7f57c5](https://github.com/gwenjs/gwen/commit/d7f57c5))
- **physics2d:** Improve dynamic body API, update vite plugin, and add integration tests ([b060b65](https://github.com/gwenjs/gwen/commit/b060b65))
- **physics3d:** Add vite sub-key to config and thread options through module setup ([c0bc01a](https://github.com/gwenjs/gwen/commit/c0bc01a))
- **physics2d:** Add vite sub-key to config and thread debug option through module setup ([f288173](https://github.com/gwenjs/gwen/commit/f288173))
- **vite:** Expose optimizer options via GwenViteOptions and add integration tests ([d16b96d](https://github.com/gwenjs/gwen/commit/d16b96d))
- **core,vite:** Add string-name overload to defineSystem and auto-inject via Vite ([4a9efa6](https://github.com/gwenjs/gwen/commit/4a9efa6))

### 🩹 Fixes

- **ci:** Pass physics3d build-tools artifact from rust to typescript jobs ([f9fba65](https://github.com/gwenjs/gwen/commit/f9fba65))
- **kit:** Restore @gwenjs/app devDep and config.test.ts ([e65416a](https://github.com/gwenjs/gwen/commit/e65416a))
- **ci:** Build WASM before publish in release workflow ([6aabfde](https://github.com/gwenjs/gwen/commit/6aabfde))
- **math:** Suppress erasing-op warnings in tests ([6987c0a](https://github.com/gwenjs/gwen/commit/6987c0a))
- **docs:** Remove vite.config.ts from project structure, add actors/ directory ([ee17d02](https://github.com/gwenjs/gwen/commit/ee17d02))
- **docs:** Remove vite.config.ts, add actors/ dir in FR Getting Started ([c6634f1](https://github.com/gwenjs/gwen/commit/c6634f1))
- **docs:** Correct API patterns, add actors and scene-router pages ([46b12ca](https://github.com/gwenjs/gwen/commit/46b12ca))
- **docs:** Correct systems, prefabs, layouts, kit, and advanced pages ([89dd9af](https://github.com/gwenjs/gwen/commit/89dd9af))
- **docs:** Correct API patterns in FR pages, add FR actors and scene-router ([e48c93d](https://github.com/gwenjs/gwen/commit/e48c93d))
- Expose engine.debug in GwenUserConfig, document global debug mode ([be94439](https://github.com/gwenjs/gwen/commit/be94439))
- Use engine.debug and process.env.NODE_ENV in debug-mode docs ([e77a27c](https://github.com/gwenjs/gwen/commit/e77a27c))
- **physics2d, physics3d:** Update _getActorEntityId import to @gwenjs/core/actor ([7273a5e](https://github.com/gwenjs/gwen/commit/7273a5e))
- **physics2d:** Update @gwenjs/kit imports to use scoped subpaths ([0e026be](https://github.com/gwenjs/gwen/commit/0e026be))
- **physics2d,physics3d,app:** Update test mocks/imports to scoped subpaths ([d83852a](https://github.com/gwenjs/gwen/commit/d83852a))
- **docs,core:** Fix remaining stray flat imports and update core tests ([e1c2c62](https://github.com/gwenjs/gwen/commit/e1c2c62))
- **docs:** Correct Physics2DAPI, Physics3DAPI and vite plugin imports ([b183652](https://github.com/gwenjs/gwen/commit/b183652))
- **docs:** Correct onUpdate signature and API patterns in physics3d-composables ([b53cce8](https://github.com/gwenjs/gwen/commit/b53cce8))
- Resolve all oxlint warnings and errors ([dd50a38](https://github.com/gwenjs/gwen/commit/dd50a38))
- **ci:** Disable criterion default features to fix wasm32 build ([212e9ec](https://github.com/gwenjs/gwen/commit/212e9ec))
- **core:** Replace no-op update_entity_archetype with add_component in wasm test ([e42c90a](https://github.com/gwenjs/gwen/commit/e42c90a))
- **physics2d,physics3d:** Fix logger initialization breaking tests with mocked @gwenjs/core ([976e1c3](https://github.com/gwenjs/gwen/commit/976e1c3))
- **physics3d:** Fix format ([cf75fab](https://github.com/gwenjs/gwen/commit/cf75fab))
- **vite:** Fix dist declaration paths and point exports to dist ([dbe9052](https://github.com/gwenjs/gwen/commit/dbe9052))
- **vite:** Add shared/layer-utils entry point to build ([ca99168](https://github.com/gwenjs/gwen/commit/ca99168))
- Fix verdaccio storage path and publish packages individually ([c2972c6](https://github.com/gwenjs/gwen/commit/c2972c6))
- Use pnpm instead of npm in verdaccio publish script for auth ([5abefce](https://github.com/gwenjs/gwen/commit/5abefce))
- Fix verdaccio publish summary to show all published packages ([f98469b](https://github.com/gwenjs/gwen/commit/f98469b))

### 💅 Refactors

- **core:** Scope @gwenjs/core/scene to scene + router only ([e11fc36](https://github.com/gwenjs/gwen/commit/e11fc36))
- **core:** Strip flat index to engine primitives only ([75ae23c](https://github.com/gwenjs/gwen/commit/75ae23c))
- **kit:** Scope flat index to shared types, add plugin/module exports ([27d91ca](https://github.com/gwenjs/gwen/commit/27d91ca))
- **core:** Extract engine-errors, engine-types, and wasm-bridge-types ([569d1d1](https://github.com/gwenjs/gwen/commit/569d1d1))
- **physics3d:** Split plugin into focused modules ([d012d17](https://github.com/gwenjs/gwen/commit/d012d17))
- **physics3d,physics2d:** Replace console calls with engine logger ([6c7b68d](https://github.com/gwenjs/gwen/commit/6c7b68d))

### 📖 Documentation

- Add EN Getting Started section ([cfe2994](https://github.com/gwenjs/gwen/commit/cfe2994))
- Add EN Essentials Part 1 (architecture, engine, components, systems) ([24b73dc](https://github.com/gwenjs/gwen/commit/24b73dc))
- Add EN Essentials Part 2 (prefabs, scenes, layouts) ([f7763d4](https://github.com/gwenjs/gwen/commit/f7763d4))
- Add EN Going Further section (tween, error-bus, debug-mode) ([1d7c958](https://github.com/gwenjs/gwen/commit/1d7c958))
- Add EN Physics composables section ([5f76bdf](https://github.com/gwenjs/gwen/commit/5f76bdf))
- Add EN Kit — Extending GWEN section ([dddb786](https://github.com/gwenjs/gwen/commit/dddb786))
- Add EN API Reference section ([7c37df4](https://github.com/gwenjs/gwen/commit/7c37df4))
- Add FR Getting Started section ([b074263](https://github.com/gwenjs/gwen/commit/b074263))
- Add FR Essentials Part 1 ([08f867d](https://github.com/gwenjs/gwen/commit/08f867d))
- Translate scenes, prefabs, layouts to French ([bcb140a](https://github.com/gwenjs/gwen/commit/bcb140a))
- Translate Going Further section to French (tween, error-bus, debug-mode) ([f67614e](https://github.com/gwenjs/gwen/commit/f67614e))
- **docs:** Translate Physics section (physics2d, physics3d composables) ([03624c9](https://github.com/gwenjs/gwen/commit/03624c9))
- Translate Kit section to French (overview, custom-plugin, custom-module, composing) ([1fe115c](https://github.com/gwenjs/gwen/commit/1fe115c))
- Translate API Reference section to French (8 packages) ([d7248ce](https://github.com/gwenjs/gwen/commit/d7248ce))
- **docs:** Add internal contributor documentation ([7929444](https://github.com/gwenjs/gwen/commit/7929444))
- Fix bootstrap docs, remove auto-generated files, add vite extension section ([d304b70](https://github.com/gwenjs/gwen/commit/d304b70))
- Remove stale duplicate content from FR project-structure ([a0de47c](https://github.com/gwenjs/gwen/commit/a0de47c))
- Fix quality issues in bootstrap + engine pages (EN+FR) ([0b02620](https://github.com/gwenjs/gwen/commit/0b02620))
- Clarify scenes vs scene-router scope, add cross-links ([edab581](https://github.com/gwenjs/gwen/commit/edab581))
- Fix scene-router quality issues (signature consistency, imports, FR grammar) ([1050f45](https://github.com/gwenjs/gwen/commit/1050f45))
- Fix missing await on nav.send() with params ([d1d76f3](https://github.com/gwenjs/gwen/commit/d1d76f3))
- Add useService, useWasmModule, useTransform, defineEvents to systems and actors ([c734149](https://github.com/gwenjs/gwen/commit/c734149))
- Fix minor quality issues in systems and actors (FR grammar, unused imports, parity) ([2486a02](https://github.com/gwenjs/gwen/commit/2486a02))
- Add defineSequence to tween, fix physics in debug, add EngineStats and createLogger ([4d9537e](https://github.com/gwenjs/gwen/commit/4d9537e))
- Fix FR debug-mode quality issues (onStart, prose gaps, grammar) ([b50aa57](https://github.com/gwenjs/gwen/commit/b50aa57))
- Add full physics2d config table and helpers section ([19e1fde](https://github.com/gwenjs/gwen/commit/19e1fde))
- Use "module" instead of "plugin" for physics2d in composables docs ([04f1ccc](https://github.com/gwenjs/gwen/commit/04f1ccc))
- Fix definePlugin API, add WASM plugin section, add vite-config page ([eb3b432](https://github.com/gwenjs/gwen/commit/eb3b432))
- Fix duplicate frontmatter in custom-plugin, standardize heading case ([9943af4](https://github.com/gwenjs/gwen/commit/9943af4))
- Fix module API — use string names in modules array, remove auto-managed bootstrap ([f22ce1e](https://github.com/gwenjs/gwen/commit/f22ce1e))
- Update scene imports to @gwenjs/core/scene ([d23bb1d](https://github.com/gwenjs/gwen/commit/d23bb1d))
- Update actor imports to @gwenjs/core/actor ([9247781](https://github.com/gwenjs/gwen/commit/9247781))
- **kit:** Update imports to @gwenjs/kit/plugin and @gwenjs/kit/module ([8b9206b](https://github.com/gwenjs/gwen/commit/8b9206b))
- Update system page imports to @gwenjs/core/system ([3e66ce5](https://github.com/gwenjs/gwen/commit/3e66ce5))
- Update guide page imports to correct subpaths ([8ec2e51](https://github.com/gwenjs/gwen/commit/8ec2e51))
- Restructure API reference pages by subpath ([15d0046](https://github.com/gwenjs/gwen/commit/15d0046))
- Update FR pages to scoped subpath imports ([c3e9a7c](https://github.com/gwenjs/gwen/commit/c3e9a7c))
- Add local registry (Verdaccio) maintainer guide ([ac285ab](https://github.com/gwenjs/gwen/commit/ac285ab))
- Align documentation with actual API and add agent guidelines ([1ec0398](https://github.com/gwenjs/gwen/commit/1ec0398))
- Rewrite physics2d, physics3d, and vite API references ([6c08256](https://github.com/gwenjs/gwen/commit/6c08256))
- Clarify prefab spawn() flat-merge behavior and fix ambiguous examples ([6a2ae53](https://github.com/gwenjs/gwen/commit/6a2ae53))
- Update systems and hooks pages for new defineSystem naming ([5ba3bb8](https://github.com/gwenjs/gwen/commit/5ba3bb8))
- Replace _plugin.spawn/despawn/get with useActor() handle in actors page ([3f70db4](https://github.com/gwenjs/gwen/commit/3f70db4))
- **math:** Rewrite @gwenjs/math reference with accurate types and full API ([3cb7665](https://github.com/gwenjs/gwen/commit/3cb7665))
- Add root README.md ([dfa1a1d](https://github.com/gwenjs/gwen/commit/dfa1a1d))
- Add GitHub Pages URL to README ([9ddc7fa](https://github.com/gwenjs/gwen/commit/9ddc7fa))
- Add badges to README ([620d5bd](https://github.com/gwenjs/gwen/commit/620d5bd))
- Add mandatory validation rules section to CLAUDE.md ([08a0f63](https://github.com/gwenjs/gwen/commit/08a0f63))

### 🏡 Chore

- Init pnpm workspace ([8e62520](https://github.com/gwenjs/gwen/commit/8e62520))
- **ci:** Add CI, Release Please and docs deployment ([4c01c7f](https://github.com/gwenjs/gwen/commit/4c01c7f))
- Add commitlint and husky ([7850f39](https://github.com/gwenjs/gwen/commit/7850f39))
- **docs:** Add vitepress skeleton ([3228f45](https://github.com/gwenjs/gwen/commit/3228f45))
- **math:** Add math package ([a51d13a](https://github.com/gwenjs/gwen/commit/a51d13a))
- **schema:** Add schema package ([a488423](https://github.com/gwenjs/gwen/commit/a488423))
- **core:** Add core package ([09a633c](https://github.com/gwenjs/gwen/commit/09a633c))
- **kit:** Add kit package ([8b437bd](https://github.com/gwenjs/gwen/commit/8b437bd))
- **physics2d:** Add physics2d package ([0632f70](https://github.com/gwenjs/gwen/commit/0632f70))
- **physics3d:** Add physics3d package ([3247a9e](https://github.com/gwenjs/gwen/commit/3247a9e))
- **vite:** Add vite package ([f7306bc](https://github.com/gwenjs/gwen/commit/f7306bc))
- Fix typecheck command and pre-existing lint errors ([75fa825](https://github.com/gwenjs/gwen/commit/75fa825))
- Add build:wasm:tools script and wire into install:all ([7f9ff8e](https://github.com/gwenjs/gwen/commit/7f9ff8e))
- **app:** Add app package ([9cd1bc4](https://github.com/gwenjs/gwen/commit/9cd1bc4))
- **docs:** Scaffold VitePress i18n structure ([c1794c8](https://github.com/gwenjs/gwen/commit/c1794c8))
- **ci:** Add verdaccio local registry setup ([92fa7a0](https://github.com/gwenjs/gwen/commit/92fa7a0))
- Add physics3d-fracture package and update dependencies ([445a86e](https://github.com/gwenjs/gwen/commit/445a86e))
- **physics3d:** Update package.json ([026bbd0](https://github.com/gwenjs/gwen/commit/026bbd0))
- **core:** Add typecheck script ([27820d7](https://github.com/gwenjs/gwen/commit/27820d7))
- Apply formatter ([4f4a7e1](https://github.com/gwenjs/gwen/commit/4f4a7e1))
- Change email ([5268364](https://github.com/gwenjs/gwen/commit/5268364))

### ✅ Tests

- **core:** Add integration tests ([abffcdc](https://github.com/gwenjs/gwen/commit/abffcdc))
- **core:** Apply CI margin to performance thresholds ([b0e2238](https://github.com/gwenjs/gwen/commit/b0e2238))
- **core:** Add warm-up run and increase CI margin for useEngine perf test ([0ea9337](https://github.com/gwenjs/gwen/commit/0ea9337))
- Add ciThreshold helper and apply to all performance tests ([7d55311](https://github.com/gwenjs/gwen/commit/7d55311))
- **physics2d:** Add warm-up and increase CI margin for ring buffer drain test ([81033a9](https://github.com/gwenjs/gwen/commit/81033a9))

### 🤖 CI

- Bump GitHub Actions to Node.js 24 compatible versions ([a924820](https://github.com/gwenjs/gwen/commit/a924820))
- Pass physics3d-fracture wasm artifact to typescript job ([36b1283](https://github.com/gwenjs/gwen/commit/36b1283))
- Pass core wasm artifact to bench job ([4e07964](https://github.com/gwenjs/gwen/commit/4e07964))

### ❤️ Contributors

- Jonathan Moutier ([@djodjonx](https://github.com/djodjonx))


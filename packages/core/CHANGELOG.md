# Changelog

## [0.2.1](https://github.com/gwenjs/gwen/compare/core-v0.2.0...core-v0.2.1) (2026-04-11)


### Bug Fixes

* correct publishConfig subpath exports to point to dedicated dist chunks ([ad31d31](https://github.com/gwenjs/gwen/commit/ad31d314e6515f1105ab537e9cd6fcd662a4cb68))

## [0.2.0](https://github.com/gwenjs/gwen/compare/core-v0.1.0...core-v0.2.0) (2026-04-09)


### Features

* **core,kit:** scoped subpath exports for @gwenjs/core and @gwenjs/kit ([5e9445e](https://github.com/gwenjs/gwen/commit/5e9445ec5bae2541192abad2121f6a7eb847a311))
* **core,vite:** add string-name overload to defineSystem and auto-inject via Vite ([4a9efa6](https://github.com/gwenjs/gwen/commit/4a9efa62840fa6734370c3213224bb423b2cc66e))
* **core:** add @gwenjs/core/actor entry point ([5862e73](https://github.com/gwenjs/gwen/commit/5862e739434c002b2cd8456384760233368ca79e))
* **core:** add @gwenjs/core/system entry point ([80b743f](https://github.com/gwenjs/gwen/commit/80b743fd4bcf79400d37b0a16c15261afbb26314))
* **core:** add useEntityId() composable to @gwenjs/core/actor ([8ad732c](https://github.com/gwenjs/gwen/commit/8ad732c186db19ef4dc89f933939274611ddb72d))
* **core:** add useHook and onCleanup composables with universal auto-cleanup ([d7f57c5](https://github.com/gwenjs/gwen/commit/d7f57c521a2cf82449f3a23e91940391f74b03f6))
* **core:** wire package.json exports and tsconfig paths for subpaths ([3d79224](https://github.com/gwenjs/gwen/commit/3d7922429dbcc27cd6168a0e015e910186867fe5))


### Bug Fixes

* **ci:** add pathsToAliases: false to all packages using vite-plugin-dts ([c40fc2e](https://github.com/gwenjs/gwen/commit/c40fc2ef4f7f1d640c68e7e2ac3c587b5bad4e37))
* **core:** address reviewer feedback on useEntityId ([356ce5b](https://github.com/gwenjs/gwen/commit/356ce5bae409a71b3f307d9475ac6c12d88ecf28))
* **docs,core:** fix remaining stray flat imports and update core tests ([e1c2c62](https://github.com/gwenjs/gwen/commit/e1c2c6279c5e80335574ccee0c60bf8c7f568fb2))
* **release:** fix declaration paths and publishConfig for all packages ([f5152d5](https://github.com/gwenjs/gwen/commit/f5152d54d3939b1fbfce19586922034fbb08665a))
* resolve all oxlint warnings and errors ([dd50a38](https://github.com/gwenjs/gwen/commit/dd50a38759416d8ec50c333f3a8bbc608f008d70))

## v0.1.0 (2026-04-07)

### Initial Release

#### 🚀 Enhancements

- add string-name overload to defineSystem and auto-inject via Vite ([4a9efa6](https://github.com/gwenjs/gwen/commit/4a9efa62840fa6734370c3213224bb423b2cc66e))
- add useHook and onCleanup composables with universal auto-cleanup ([d7f57c5](https://github.com/gwenjs/gwen/commit/d7f57c521a2cf82449f3a23e91940391f74b03f6))
- scoped subpath exports for @gwenjs/core and @gwenjs/kit ([5e9445e](https://github.com/gwenjs/gwen/commit/5e9445ec5bae2541192abad2121f6a7eb847a311))
- wire package.json exports and tsconfig paths for subpaths ([3d79224](https://github.com/gwenjs/gwen/commit/3d7922429dbcc27cd6168a0e015e910186867fe5))
- add @gwenjs/core/actor entry point ([5862e73](https://github.com/gwenjs/gwen/commit/5862e739434c002b2cd8456384760233368ca79e))
- add @gwenjs/core/system entry point ([80b743f](https://github.com/gwenjs/gwen/commit/80b743fd4bcf79400d37b0a16c15261afbb26314))

#### 🩹 Fixes

- replace no-op update_entity_archetype with add_component in wasm test ([e42c90a](https://github.com/gwenjs/gwen/commit/e42c90aadf87ad9783f4bf81ae8945d945fa94db))
- fix remaining stray flat imports and update core tests ([e1c2c62](https://github.com/gwenjs/gwen/commit/e1c2c6279c5e80335574ccee0c60bf8c7f568fb2))

#### 💅 Refactors

- extract engine-errors, engine-types, and wasm-bridge-types ([569d1d1](https://github.com/gwenjs/gwen/commit/569d1d18de27afa75fd612647726a971e14b3a50))
- strip flat index to engine primitives only ([75ae23c](https://github.com/gwenjs/gwen/commit/75ae23c8daf851d5d6606cab97e83b8fcfd7bb1b))
- scope @gwenjs/core/scene to scene + router only ([e11fc36](https://github.com/gwenjs/gwen/commit/e11fc365cad6c2f01201d0b48d3efaed09763610))

#### ✅ Tests

- add warm-up run and increase CI margin for useEngine perf test ([0ea9337](https://github.com/gwenjs/gwen/commit/0ea933776406b0b973d0ef42b80808fde34ba526))
- apply CI margin to performance thresholds ([b0e2238](https://github.com/gwenjs/gwen/commit/b0e2238be4dab0484ecc43a50065709932968833))
- add integration tests ([abffcdc](https://github.com/gwenjs/gwen/commit/abffcdc844a1e38f91257bd6f7a1ccc77faae475))

#### 🏡 Chores

- add typecheck script ([27820d7](https://github.com/gwenjs/gwen/commit/27820d7503915cec8a85cc987f6626a1d04a5e0c))
- add core package ([09a633c](https://github.com/gwenjs/gwen/commit/09a633c73d2b1b3ebcabaf59b160f03dc188f32a))

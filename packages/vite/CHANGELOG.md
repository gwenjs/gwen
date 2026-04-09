# Changelog

## [0.2.0](https://github.com/gwenjs/gwen/compare/vite-v0.1.0...vite-v0.2.0) (2026-04-09)


### Features

* **core,vite:** add string-name overload to defineSystem and auto-inject via Vite ([4a9efa6](https://github.com/gwenjs/gwen/commit/4a9efa62840fa6734370c3213224bb423b2cc66e))
* **vite:** expose optimizer options via GwenViteOptions and add integration tests ([d16b96d](https://github.com/gwenjs/gwen/commit/d16b96dc1b579b73f07e091ec1e5b8b9eb195cd9))


### Bug Fixes

* **ci:** add pathsToAliases: false to all packages using vite-plugin-dts ([c40fc2e](https://github.com/gwenjs/gwen/commit/c40fc2ef4f7f1d640c68e7e2ac3c587b5bad4e37))
* resolve all oxlint warnings and errors ([dd50a38](https://github.com/gwenjs/gwen/commit/dd50a38759416d8ec50c333f3a8bbc608f008d70))
* **scripts:** unpublish before publish to avoid Verdaccio 409 conflicts ([ca99168](https://github.com/gwenjs/gwen/commit/ca99168c79c1a6bbebaba75c78e40d594fff0aa5))
* **vite:** add shared/layer-utils entry point to build ([ca99168](https://github.com/gwenjs/gwen/commit/ca99168c79c1a6bbebaba75c78e40d594fff0aa5))
* **vite:** fix dist declaration paths and point exports to dist ([dbe9052](https://github.com/gwenjs/gwen/commit/dbe905246d887afb64257a148bb51515a284b446))

## v0.1.0 (2026-04-07)

### Initial Release

#### 🚀 Enhancements

- add string-name overload to defineSystem and auto-inject via Vite ([4a9efa6](https://github.com/gwenjs/gwen/commit/4a9efa62840fa6734370c3213224bb423b2cc66e))
- expose optimizer options via GwenViteOptions and add integration tests ([d16b96d](https://github.com/gwenjs/gwen/commit/d16b96dc1b579b73f07e091ec1e5b8b9eb195cd9))

#### 🩹 Fixes

- add shared/layer-utils entry point to build ([ca99168](https://github.com/gwenjs/gwen/commit/ca99168c79c1a6bbebaba75c78e40d594fff0aa5))
- fix dist declaration paths and point exports to dist ([dbe9052](https://github.com/gwenjs/gwen/commit/dbe905246d887afb64257a148bb51515a284b446))

#### 🏡 Chores

- add vite package ([f7306bc](https://github.com/gwenjs/gwen/commit/f7306bc4880ac16b45da59ef9ee02a3fb1bdec01))

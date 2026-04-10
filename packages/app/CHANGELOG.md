# Changelog

## [0.3.0](https://github.com/gwenjs/gwen/compare/app-v0.2.0...app-v0.3.0) (2026-04-10)


### Features

* **app:** add viewports support via gwen.config.ts ([eaddd4a](https://github.com/gwenjs/gwen/commit/eaddd4abd9f1d8edea3e59be093a9f0d7cef9205))


### Bug Fixes

* **app:** address code review on viewports support ([9bd793b](https://github.com/gwenjs/gwen/commit/9bd793bab98427619dfb4045852f5a6a9e679d61))

## [0.2.0](https://github.com/gwenjs/gwen/compare/app-v0.1.0...app-v0.2.0) (2026-04-09)


### Features

* **core,kit:** scoped subpath exports for @gwenjs/core and @gwenjs/kit ([5e9445e](https://github.com/gwenjs/gwen/commit/5e9445ec5bae2541192abad2121f6a7eb847a311))
* **core:** add useHook and onCleanup composables with universal auto-cleanup ([d7f57c5](https://github.com/gwenjs/gwen/commit/d7f57c521a2cf82449f3a23e91940391f74b03f6))


### Bug Fixes

* **ci:** add pathsToAliases: false to all packages using vite-plugin-dts ([c40fc2e](https://github.com/gwenjs/gwen/commit/c40fc2ef4f7f1d640c68e7e2ac3c587b5bad4e37))
* **ci:** address Copilot review feedback on PR [#14](https://github.com/gwenjs/gwen/issues/14) ([f33450f](https://github.com/gwenjs/gwen/commit/f33450f5e619f459b28a3a8d1f7fa0fb94069d34))
* **ci:** resolve release build errors and eliminate vite warnings ([be7495b](https://github.com/gwenjs/gwen/commit/be7495bb9aeafe9d49fdc6da8ee859f64ca576ca))
* expose engine.debug in GwenUserConfig, document global debug mode ([be94439](https://github.com/gwenjs/gwen/commit/be94439ce8969a5d3b0d1221fa7185f4b227e8d5))
* **kit,app:** point kit exports to dist and tighten hook type ([5f43489](https://github.com/gwenjs/gwen/commit/5f43489e38213aacced02ed0556a2db50b6927bf))
* **physics2d,physics3d,app:** update test mocks/imports to scoped subpaths ([d83852a](https://github.com/gwenjs/gwen/commit/d83852a3f9c71f4f24f35e299417452b69b35a07))
* **physics2d:** update @gwenjs/kit imports to use scoped subpaths ([0e026be](https://github.com/gwenjs/gwen/commit/0e026be25f0729e8d50e0b477a95ee34f81acaa8))
* **release:** fix declaration paths and publishConfig for all packages ([f5152d5](https://github.com/gwenjs/gwen/commit/f5152d54d3939b1fbfce19586922034fbb08665a))

## v0.1.0 (2026-04-07)

### Initial Release

#### 🩹 Fixes

- update test mocks/imports to scoped subpaths ([d83852a](https://github.com/gwenjs/gwen/commit/d83852a3f9c71f4f24f35e299417452b69b35a07))

#### 🏡 Chores

- add app package ([9cd1bc4](https://github.com/gwenjs/gwen/commit/9cd1bc407d8feb989281914598d73c8f89206494))

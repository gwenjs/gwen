# Changelog

## [0.2.0](https://github.com/gwenjs/gwen/compare/physics3d-v0.1.0...physics3d-v0.2.0) (2026-04-08)


### Features

* **core,kit:** scoped subpath exports for @gwenjs/core and @gwenjs/kit ([5e9445e](https://github.com/gwenjs/gwen/commit/5e9445ec5bae2541192abad2121f6a7eb847a311))
* **core:** add useHook and onCleanup composables with universal auto-cleanup ([d7f57c5](https://github.com/gwenjs/gwen/commit/d7f57c521a2cf82449f3a23e91940391f74b03f6))
* **physics3d:** add vite sub-key to config and thread options through module setup ([c0bc01a](https://github.com/gwenjs/gwen/commit/c0bc01a9370f3f867b9b565a975ca362540c20bf))


### Bug Fixes

* **math:** suppress erasing-op warnings in tests ([6987c0a](https://github.com/gwenjs/gwen/commit/6987c0ad6928a4354ce2c40f13cf8141db58ff5e))
* **physics2d, physics3d:** update _getActorEntityId import to @gwenjs/core/actor ([7273a5e](https://github.com/gwenjs/gwen/commit/7273a5e409e7df914b35cda21a9ebaaff4a67839))
* **physics2d,physics3d,app:** update test mocks/imports to scoped subpaths ([d83852a](https://github.com/gwenjs/gwen/commit/d83852a3f9c71f4f24f35e299417452b69b35a07))
* **physics2d,physics3d:** fix logger initialization breaking tests with mocked @gwenjs/core ([976e1c3](https://github.com/gwenjs/gwen/commit/976e1c32bdd2aaeeb4556e92488ec905796be7d5))
* **physics2d:** update @gwenjs/kit imports to use scoped subpaths ([0e026be](https://github.com/gwenjs/gwen/commit/0e026be25f0729e8d50e0b477a95ee34f81acaa8))
* **physics3d:** fix format ([cf75fab](https://github.com/gwenjs/gwen/commit/cf75fab20820afbdb532763afee6337abb8a9e55))
* **release:** fix declaration paths and publishConfig for all packages ([f5152d5](https://github.com/gwenjs/gwen/commit/f5152d54d3939b1fbfce19586922034fbb08665a))
* resolve all oxlint warnings and errors ([dd50a38](https://github.com/gwenjs/gwen/commit/dd50a38759416d8ec50c333f3a8bbc608f008d70))

## v0.1.0 (2026-04-07)

### Initial Release

#### 🚀 Enhancements

- add vite sub-key to config and thread options through module setup ([c0bc01a](https://github.com/gwenjs/gwen/commit/c0bc01a9370f3f867b9b565a975ca362540c20bf))

#### 🩹 Fixes

- fix format ([cf75fab](https://github.com/gwenjs/gwen/commit/cf75fab20820afbdb532763afee6337abb8a9e55))
- fix logger initialization breaking tests with mocked @gwenjs/core ([976e1c3](https://github.com/gwenjs/gwen/commit/976e1c32bdd2aaeeb4556e92488ec905796be7d5))
- update test mocks/imports to scoped subpaths ([d83852a](https://github.com/gwenjs/gwen/commit/d83852a3f9c71f4f24f35e299417452b69b35a07))
- update \_getActorEntityId import to @gwenjs/core/actor ([7273a5e](https://github.com/gwenjs/gwen/commit/7273a5e409e7df914b35cda21a9ebaaff4a67839))

#### 💅 Refactors

- replace console calls with engine logger ([6c7b68d](https://github.com/gwenjs/gwen/commit/6c7b68d83cb10f9cdc7f6ea854c00b6457cba242))
- split plugin into focused modules ([d012d17](https://github.com/gwenjs/gwen/commit/d012d174d964194989ffd9218f730a459052ed10))

#### 🏡 Chores

- update package.json ([026bbd0](https://github.com/gwenjs/gwen/commit/026bbd074c37caaae5e5ca4eb085bdd28cb3fad1))
- add physics3d package ([3247a9e](https://github.com/gwenjs/gwen/commit/3247a9eea54d838620704bea34218d77cfd32d3b))

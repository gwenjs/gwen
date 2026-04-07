# Changelog

## v0.1.0 (2026-04-07)

### Initial Release

#### 🚀 Enhancements

- add vite sub-key to config and thread debug option through module setup ([f288173](https://github.com/gwenjs/gwen/commit/f288173e2e4a1ddabd1ea1ea70c84621fdee7a7c))
- improve dynamic body API, update vite plugin, and add integration tests ([b060b65](https://github.com/gwenjs/gwen/commit/b060b656e75ae3668b8a13c9c5bbbd0045d25b3f))

#### 🩹 Fixes

- fix logger initialization breaking tests with mocked @gwenjs/core ([976e1c3](https://github.com/gwenjs/gwen/commit/976e1c32bdd2aaeeb4556e92488ec905796be7d5))
- update test mocks/imports to scoped subpaths ([d83852a](https://github.com/gwenjs/gwen/commit/d83852a3f9c71f4f24f35e299417452b69b35a07))
- update @gwenjs/kit imports to use scoped subpaths ([0e026be](https://github.com/gwenjs/gwen/commit/0e026be25f0729e8d50e0b477a95ee34f81acaa8))
- update _getActorEntityId import to @gwenjs/core/actor ([7273a5e](https://github.com/gwenjs/gwen/commit/7273a5e409e7df914b35cda21a9ebaaff4a67839))

#### 💅 Refactors

- replace console calls with engine logger ([6c7b68d](https://github.com/gwenjs/gwen/commit/6c7b68d83cb10f9cdc7f6ea854c00b6457cba242))

#### ✅ Tests

- add warm-up and increase CI margin for ring buffer drain test ([81033a9](https://github.com/gwenjs/gwen/commit/81033a96a7e6a105428d503335bec2812388d190))

#### 🏡 Chores

- add physics2d package ([0632f70](https://github.com/gwenjs/gwen/commit/0632f70eeca089b5ef3388d222288e8ade6cd746))

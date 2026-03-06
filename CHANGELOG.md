# Changelog

All notable changes to this project will be documented in this file.

## [1.4.4](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.4.3...v1.4.4) (2026-03-06)

### ♻️ Code Refactoring

* **routes:** remove redundant routes for environment management ([db15886](https://github.com/devopsgroupeu/openprime-app-backend/commit/db15886b1652e25615d4103b199bab53c3044556))

## [1.4.3](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.4.2...v1.4.3) (2026-03-06)

### 🐛 Bug Fixes

* secure AI route and fix git push race conditions ([#5](https://github.com/devopsgroupeu/openprime-app-backend/issues/5)) ([63e8bdc](https://github.com/devopsgroupeu/openprime-app-backend/commit/63e8bdc712d91e2bedb81d7feb098df6e901475b))

## [1.4.2](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.4.1...v1.4.2) (2026-03-04)

### 🐛 Bug Fixes

* **templating:** fix git variables to correctly pass to Injecto ([f375ae9](https://github.com/devopsgroupeu/openprime-app-backend/commit/f375ae9de5d046357fd879c1aa9e6a918ef6c4f0))

## [1.4.1](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.4.0...v1.4.1) (2026-03-03)

### 🐛 Bug Fixes

* **s3_backend:** fix templating of s3 bucket terraform backend, set s3 locking as default ([af4f243](https://github.com/devopsgroupeu/openprime-app-backend/commit/af4f243ba7711e0cc79e899d7a7041d8c31515b5))

## [1.4.0](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.3.0...v1.4.0) (2026-03-03)

### 🚀 Features

* **OPE-138:** git push functionality ([#3](https://github.com/devopsgroupeu/openprime-app-backend/issues/3)) ([2c7a6d6](https://github.com/devopsgroupeu/openprime-app-backend/commit/2c7a6d608768f64bccb875f2272244d98b964e17))

## [1.3.0](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.2.0...v1.3.0) (2026-03-02)

### 🚀 Features

* **cicd:** mirror cicd setup from openprime-app, update pre-commit, formatting ([#4](https://github.com/devopsgroupeu/openprime-app-backend/issues/4)) ([9ed6ace](https://github.com/devopsgroupeu/openprime-app-backend/commit/9ed6ace75daec41d504c156364370213d6329913))

## [1.2.0](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.1.0...v1.2.0) (2026-02-24)

### 🚀 Features

* **cicd:** add commitlintrc.json ([8420f30](https://github.com/devopsgroupeu/openprime-app-backend/commit/8420f309cf0bac322d7c5f47085975950c7f23d2))

## [1.1.0](https://github.com/devopsgroupeu/openprime-app-backend/compare/v1.0.0...v1.1.0) (2026-02-24)

### 🚀 Features

* **cicd:** refactor github workflows ([9e19bef](https://github.com/devopsgroupeu/openprime-app-backend/commit/9e19bef9657f7947256ef11c5c93184e1534517e))

## 1.0.0 (2026-02-24)

### 🚀 Features

* add cloud credentials management system ([0ad3ec3](https://github.com/devopsgroupeu/openprime-app-backend/commit/0ad3ec326807d1c5b41a488c599433bc235739c1))
* add Git repository and Terraform backend configuration support ([aacc47a](https://github.com/devopsgroupeu/openprime-app-backend/commit/aacc47adada06ca974254a3d758cc131dfd24da7))
* add Terraform backend resource creation API ([ff71b3a](https://github.com/devopsgroupeu/openprime-app-backend/commit/ff71b3a21b780479e94b527c03a8ec8a105ca769))
* **chart:** add existingSecret support for external secrets management ([daa3854](https://github.com/devopsgroupeu/openprime-app-backend/commit/daa38541482d704c896eac235396b4c99491c174))
* **environment:** add global prefix field for resource naming ([ed91a7a](https://github.com/devopsgroupeu/openprime-app-backend/commit/ed91a7a8964e3a9370eb39073484399d875a2ba5))
* **server:** add trust proxy setting for ingress compatibility ([92c45df](https://github.com/devopsgroupeu/openprime-app-backend/commit/92c45df31a70b09fb4d11a5d9ded5edc6533cd4c))

### 🐛 Bug Fixes

* add sequelize.define mock and model association methods for tests ([cc7dad7](https://github.com/devopsgroupeu/openprime-app-backend/commit/cc7dad75874896a3b7f987a7fc597160c5ee03c9))
* **build:** hotfix build workflow ([ea8fdd1](https://github.com/devopsgroupeu/openprime-app-backend/commit/ea8fdd146ed86b680aa820862b6104068c04fdc7))
* **build:** hotfix github workflows ([280a6be](https://github.com/devopsgroupeu/openprime-app-backend/commit/280a6be08592609b00adce7cad265c06ab635961))
* **build:** hotfix helm-chart workflow ([02ebb46](https://github.com/devopsgroupeu/openprime-app-backend/commit/02ebb460ddc3ed4db2ee34784fd10209bace2502))
* **chart:** add strategy default, remove imagePullSecrets ([95c1fea](https://github.com/devopsgroupeu/openprime-app-backend/commit/95c1feaac8ca9c5125001deabac81d499fb875ce))
* **cicd:** install @semantic-release/commit-analyzer npm package ([697c697](https://github.com/devopsgroupeu/openprime-app-backend/commit/697c697117073f50256b21fe572ec5db122fbf60))
* **cicd:** move semantic release packages to dev ([d50fb07](https://github.com/devopsgroupeu/openprime-app-backend/commit/d50fb07dcabc5c01bfb2d5ea7998139d4937cf64))
* **credentials:** improve error handling and change to hard delete ([1c24622](https://github.com/devopsgroupeu/openprime-app-backend/commit/1c246229100e9538f7910a9f38c4f29df0785a16))
* disable file logging in Kubernetes, use console only ([7c9ee6a](https://github.com/devopsgroupeu/openprime-app-backend/commit/7c9ee6aae1609090eeb3c76a88698b4e87893b2a))
* resolve test failures blocking CI/CD pipeline ([87d0298](https://github.com/devopsgroupeu/openprime-app-backend/commit/87d029896f67bccfc4da21d41fe00cb64b7b9e45))
* **tests:** add required environment variables and mocks for test setup ([47e29c9](https://github.com/devopsgroupeu/openprime-app-backend/commit/47e29c90ef744c469e792f79db05921381585927))
* use config.bucketName in catch blocks to fix scope error ([752664e](https://github.com/devopsgroupeu/openprime-app-backend/commit/752664e3a5d23ab76fae04d18a523c7db6ee7328))

### 📚 Documentation

* add open source community files ([f6fd342](https://github.com/devopsgroupeu/openprime-app-backend/commit/f6fd3424ef1d3a0909cf9e9c16fe3b55a3a3267f))

### ♻️ Code Refactoring

* **logging:** standardize logging with request correlation and structured format ([d4c60e2](https://github.com/devopsgroupeu/openprime-app-backend/commit/d4c60e22c42249fb0ff46b17cf0db49569ae5c1f))

# Changelog

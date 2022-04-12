<!-- markdownlint-disable no-duplicate-header -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0-b.2] - 2022-04-13

* Exposed application configuration storage path for the user to be informed
* Ability to turn auto-start on or off
* Ability to re-connect
* Changed bootstrap procedure using phases/states to improve detection
* Improved bootstrap failure reasons
* Use a single configuration source
* Wrapped logging into its own module to support switching
* Clean-up of old artifacts

## [4.0.0-b.1] - 2022-04-09

* Upgrade to support podman `4.0.x`
* Upgrade to blueprint 4.x
* Support Windows
* Support MacOS
* Dropped Lima temporarily until better configuration exists

## [3.4.2-alpha.4] - 2022-02-06

### Fixed

* 14: Automatic detection failed (macOs Catalina)

## [3.4.2-alpha.3] - 2021-12-08

Support MacOS using lima, native read write mounts and terminal console

## [3.4.2-alpha.2] - 2021-12-08

Address tech debt and allow easier development.

### Changed

* Split `easy-peasy` model
* Changed application folder structure
* Add logging for all http requests with curl command construction
* Fix request parameters
* Fix secrets creation

### Added

* Prepare bundling

## [3.4.2-alpha.1] - 2021-12-06

### Added

* Initial release

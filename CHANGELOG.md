# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 5.2.2-rc.7 - 2024-09-13

## Changed

- Re-branded from `podman-desktop-companion` to `container-desktop` to avoid confusion of users and publishers with the younger `podman-desktop`

## 5.2.2-rc.6 - 2024-09-11

## Fixed

- Theme switch on connect
- Startup/Shutdown of managed hosts
- Env sourcing
- Starting containers with volumes and exposed ports
- Open in browser when applicable
- Icons generator

## Added

- Proper privacy policy page
- Graphics generator
- Self-sign test task

## Changed

- Upgraded deps
- Home page podman desktop note and redirect to avoid users getting wrong message
- Home page license and privacy notes

## Removed

- System tray screenshots as they were inaccurate

## 5.2.2-rc.5 - 2024-09-11

## Fixed

- Terminate WSL distributions only if started by pdc
- Stop LIMA instances only if started by pdc

## Added

- Icons for Windows Store

## Changed

- Privacy policy to be readable

## 5.2.2-rc.4 - 2024-09-11

## Fixed

- Properly close connections
- Auto-mode supported for all connection types
- Bug with podman not being able to create the basedir of the listening socket on WSL
- Mode change disabled while pending operation
- Registry search behavior for docker
- NSIS installer icon
- Visual bugs

## Added

- Detect button for relay endpoint

## Changed

- Display version only when connected
- Export connections with version specifier
- Connection pending indicator moved to bottom of the form
- Refactor all needed to respect containers domain
- Upgraded deps

## Removed

- Unused dependencies

## 5.2.2-rc.3 - 2024-09-08

## Fixed

- Connection defaults to first available podman (virtualized or native) at first start
- Ability to set default connection was broken

## 5.2.2-rc.2 - 2024-09-08

## Fixed

- Fixed pause / unpause of containers

## 5.2.2-rc.1 - 2024-09-08

## Added

- Application startup visual log
- Flexible connection management method and UI
- Support for custom WSL distributions
- Support for custom LIMA instances
- Support for remote SSH connection using `.ssh/config` like VS Code extension
- Ability to export / import connections
- Ability to automatically detect installed packages
- Enabled latest version check
- Latest version publishing to static website
- Footer mentioning current connection and engine version
- `No results` non-ideal state for all list screens
- Manual reload/refresh button for all list screens

## Changed

- Connection management
- Container inline player actions for stop/start/pause/restart
- Single file javascript bundling using ncc to eliminate need to distribute `node_modules` in asar package
- Tray icon with duo-tone

## Fixed

- Automatic detections
- System clean/prune
- Factory reset
- Errors properly displaying
- Various visual issues

## Removed

- Logging to file-system
- All electron languages besides `en-US` to reduce payload size

## 5.2.0-rc.4 - 2024-08-22

## Added

- Enabled latest version check
- Latest version publishing to static website

## Changed

- Make everything async
- Increase type safety
- Drop node polyfills
- Wrap node direct calls in a single `Platform` module

## Fixed

- Issue #109 - Allow flatpak version to start/stop podman native binary
- Scanner report in light mode using docker engine
- Programs detection

## 5.2.0-rc.3 - 2024-08-15

## Fixed

- Ubuntu 24.04 - apparmor template executable path was wrong
- Silenced apparmor errors where service is present / enabled but reported as not available (WSL + apparmor) - during reload

## Changed

- Included `LOW` security reporting priority counts
- Removed environment letter suffix form version reporting
- Moved helper scripts outside sources
- Updated trivy homepage URL

## Added

- Checksum generation for binaries

## 5.2.0-rc.2 - 2024-08-15

## Fixed

- Ubuntu 24.04 launching issues(added apparmor profile, electron sandbox disabling)
- On linux, electron-builder product name uses project name to avoid path with spaces issues
- Issue #103 - terminal output

## Changed

- MacOS default podman cli path
- Current version to `5.2.0` in defaults
- Changed default development port to use 3000
- Linux shortcut name changed to use project title
- Enabled ARM build for linux releases
- Upgraded dependencies
- Memory usage in human form

## 5.2.0-rc.1 - 2024-08-12

## Added

- Home page note to favor podman-desktop - major feature freezing note added.
- README.md note to favor podman-desktop
- TODO.md update to release binaries for `5.2.0-rc1`
- Links to Podman in action and Podman for DevOps books
- Changed all logos and icons to distinguish from podman desktop
- Fixed minor bugs with copy-to-clipboard, visual inconsistencies, terminal launching and shortcut entries
- Registries support(define / search / pull) - search using podman configuration for podman engine only, inline configuration(custom) for all engines
- Overlay quick start container actions on hover and tap for table users
- Expand / collapse sidebar support for more work space horizontally (persist settings across restart)
- Light mode / Dark mode toggle (already supported by the blueprintjs framework but not enabled) - for all engines
- Icons for some table views headers
- Unified navigation / inspect for all entities that support it

## Changed

- Upgraded node to 20
- Upgrades to be compatible with podman `5.2.0`
- Migrated all code to typescript (basic)
- Migrated infra to use vite instead of react-scripts
- Upgraded react blueprint framework to 5.x
- Upgraded all upgradable dependencies
- Modified CI/CD pipeline to support current version
- Modified example to work on Ubuntu 22.04 (my current OS)
- More compact lists and table views
- Unified headers with tables / lists
- Containers groups show first (like folders first in file managers)
- Pod infrastructure containers are placed in their special group, showing first if they exist
- Container logs use VT100 emulator for displaying `ansi-colors` properly (service is consuming byte array data instead of strings)

## Fixed

- Merged all dependabot PRs
- Open terminal on some platforms
- Open browser on some platforms
- Main window shows up only when UI has received all init data to avoid showing incomplete windows
- Detail tables in Drawers didn't size properly - first column was taking too much space

## Removed

- Sponsors

## 4.1.0-rc.29 - 2022-05-17

## Fixed

- Issue #85 - Detection of paths is now handled properly

## 4.1.0-rc.28 - 2022-05-17

## Fixed

- Issue #84 - Detection of versions is now handled properly
- Issue #54 - Pods tab: list with stats/start/stop
- Models reset on engine change not to confuse the users keeping old values
- Containers group header color for podman engine
- Pending indicator in the sidebar footer was a bit off vertically, now is centered
- Indentation due to css class name clashes
- Set active tab for container kube
- Ports map undefined coercion
- Detection avoids baseline versions from being reported to the user

## Changed

- Moved actions as plugins of bridge using lambda architecture - an async function with context and parameters
- Clear bridge bootstrap phase, split into `init` happening only once and `start`, each time engines are switched
- Faster and more reliable startup, less prone to crashes and easier to read
- New models should implement `ResetableModel`
- Lift error boundary so that the app still has custom title bar even when it crashes
- Improved detection flow - test paths presence on disk for required executables
- Visual improvements

## 4.1.0-rc.26 - 2022-05-15

## Fixed

- Missing scan report journal update dates and version on non-linux
- When connecting to docker engine - the app did not check if api is available and it was always connecting creating confusion

## Added

- Issue #79 as per Issue #57 - Add container grouping by prefix, only a single prefix is supported to single level depth (first part after split by `_`)

## Changed

- Improved pending indicators for long operations
- Added sorting by name for containers list
- Removed dead CSS

## [4.1.0-rc.25] - 2022-05-14

## Fixed

- Fix os missing os type dependency

## [4.1.0-rc.24] - 2022-05-14

## Added

- Error boundary to gracefully crash

## Fixed

- Regression with default connector being always checked even if the user did not set one
- No more crashes in image security screen

## [4.1.0-rc.23] - 2022-05-14

## Added

- Container Image security scan screen with Trivy

## Fixed

- Machine commands were broken (restart, stop, remove)

## Others

- Separated responsibilities
- Started work on plugin architecture

## [4.1.0-rc.22] - 2022-05-14

## Added

- Network creation for podman end docker engines (no subnet support for docker for now)

## Changed

- Activated stdout / stderr logging when level is debug for what is output coming from locally started apis for better tracing

## [4.1.0-rc.21] - 2022-05-13

## Changed

- Prevent stopping api on engine switching if not started by podman desktop companion

## [4.1.0-rc.20] - 2022-05-13

## Fixed

- issue #64 - Blank page after loading
- issue #77 - Missing podman-machine-default machine
- issue #73 - "Path to native podman CLI" disappears after saving
- issue #56 - UI freezes and cannot get back to configuration menu

## Added

- Show program version in settings screen header left column

## Changed

- Connection methods
- Upgraded electron engine
- Separated concerns (some)
- Moved back to IPC instead of works as they are faster
- Changed bootstrap method to be more stable in case of program failures

## [4.1.0-rc.11] - 2022-05-11

- issue #73 - Prevent crashing if no programs or versions are found - do not merge empty strings, default as `undefined` is required for proper merge

## [4.1.0-rc.10] - 2022-05-11

- issue #73 - Read and write settings without needing to spawn a worker

## [4.1.0-rc.9] - 2022-05-11

- Fix UI blocking when server detections fail abruptly
- Moved all time consuming operations to web-workers
- Call socket api when possible

## [4.1.0-rc.8] - 2022-05-09

- Attempt solving startup issues
- Added strict engine checks to avoid invalid operations on platforms that do not need it
- Added pod logs viewer
- Added jump to list for all screens to avoid back button confusion

## [4.1.0-rc.1] - 2022-05-09

### Added

- Added view kube yaml for pod
- Added view kube yaml for container
- Pods section processes
- Pods section list
- Pods section inspect
- Multiple container engine support
- Docker engine support
- Podman and Docker support for operating modes
- Adaptive color scheme to dissociate between engines (original for podman and blue for docker)
- Ability to customize path to podman / docker and their connection strings
- Ability to test custom configuration
- Ability to save customization and restore defaults
- Ability to detect what is currently available
- Full support for custom LIMA instance and WSL distributions for both engines
- 45: Added support for Windows Terminal as tool for "Open terminal" functionality
- Ability to dissociated between container states using colors
- Refactored the entire application to support any container engine easily

## Changed

- Improved error messages everywhere
- Changed configuration and logging location, less screen vertical real-estate used
- Upgraded all dependencies to their most recent supported versions

## Fixed

- 56: Podman machine startup / shutdown

## [4.0.3-rc.5] - 2022-04-23

### Added

- Connection system
- Experimental Docker API

### Changed

- 47: Allow custom connection string
- Connection UI
- Various UI improvements
- Disable screens not making sense when using certain engines

## [4.0.3-rc.4] - 2022-04-18

### Fixed

- 44: Fix Open in Browsers due to schema changes
- 49: UI freezes on Start a new container
- Overflow issues triggering vertical & horizontal scrolling
- Bug with pause / resume of containers

### Added

- 43: Restore LIMA
- Ability to switch logging to original console, to avoid losing lines
- Add more info about the environment where podman is running
- Port mappings as array of items - ability to map any port/protocol
- Add created counter on dashboard

### Changed

- Improved detection of locally available podman, podman machine, LIMA
- Ability to connect without restart when switching engines (from native to machine, from machine to lima and back)
- Improved error handling and notifications
- Simplified logging

### Removed

- Removed worker PRC - proxy all through Electron IPC
- CLI backend for communication - it was too limiting

## [4.0.3-rc.3] - 2022-04-18

### Added

- Builds for `M1` architecture
- Counters for `paused` and `exited` on Dashboard screen
- Ability to `pause / unpause` a container
- Basic `System Tray` support (restore window & quit - no startup to tray)

### Fixed

- Fix Dashboard wrong counters
- Fixed icon path in development mode
- Fixed window restoration on MacOS

### Changed

- Added HTTP response `ok` state interpretation
- Changed build pipeline to be more explicit
- Added `DecodedState` computed property to `Container` type to avoid miss-match data when requesting lists vs single items
- Rephrased counters for running containers

### Removed

- Removed extra `Status` column from `Containers` list screen

## [4.0.3-rc.2] - 2022-04-16

- initial flatpak support (not yet flathub)
- solve custom program path setting bug

## [4.0.3-b.5] - 2022-04-15

- Fix improper request body proxy-ing to worker affecting requests methods with body
- Add BDD initial testing for the client

## [4.0.3-b.4] - 2022-04-14

- Add `cli` fallback when `api` is not available
- Refactor settings UI to allow toggling of `cli` fallback

## [4.0.3-b.3] - 2022-04-13

- Properly respect build environment

## [4.0.3-b.2] - 2022-04-13

- Enable debug panel for production builds

## [4.0.3-b.1] - 2022-04-13

- Ability to control logging level and debug the application
- Provider more information and control over startup and internals

## [4.0.0-b.2] - 2022-04-13

- Exposed application configuration storage path for the user to be informed
- Ability to turn auto-start on or off
- Ability to re-connect
- Changed bootstrap procedure using phases/states to improve detection
- Improved bootstrap failure reasons
- Use a single configuration source
- Wrapped logging into its own module to support switching
- Clean-up of old artifacts

## [4.0.0-b.1] - 2022-04-09

- Upgrade to support podman `4.0.x`
- Upgrade to blueprint 4.x
- Support Windows
- Support MacOS
- Dropped Lima temporarily until better configuration exists

## [3.4.2-alpha.4] - 2022-02-06

### Fixed

- 14: Automatic detection failed (macOs Catalina)

## [3.4.2-alpha.3] - 2021-12-08

Support MacOS using lima, native read write mounts and terminal console

## [3.4.2-alpha.2] - 2021-12-08

Address tech debt and allow easier development.

### Changed

- Split `easy-peasy` model
- Changed application folder structure
- Add logging for all http requests with curl command construction
- Fix request parameters
- Fix secrets creation

### Added

- Prepare bundling

## [3.4.2-alpha.1] - 2021-12-06

### Added

- Initial release

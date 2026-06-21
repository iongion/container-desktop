# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## Changed

- Network settings now support a test-before-save global proxy for app traffic and native Podman commands.
- AI chat composer: pick the inference source → provider → model in a popover with live discovery — LM Studio is the default, OpenRouter lists its models grouped by vendor with search, and the popover sizes to its content.
- AI Assistant settings is now a two-column provider **connection** configurator — choose a provider, then set its endpoint, authentication and credentials and **Test the connection**. Each provider offers only the auth schemes it supports (clouds: API key; local servers: keyless or an optional API key; user-added gateways can also use Basic or a custom header). Credentials live in the OS keychain — saving an empty secret removes it. Model selection now lives only in the composer; settings no longer drills into models.
- AI is always on — removed the "enable AI", "local-only" and "allow cloud" toggles. A provider is local (LM Studio / llama.cpp) or cloud by nature, and saving a cloud provider's API key is the consent to use it; loopback local providers keep everything on your device.
- The AI Assistant is one always-agentic conversation that can run host commands to inspect and fix your container setup, gated by a permission mode chosen in the composer: **Always ask** (approve each command), **Ask and remember** (approve once, then it remembers your allow/reject), or **Always allow** (run everything, full trust). A catastrophic-command floor (destructive/privileged/shell programs, shell metacharacters, path traversal) applies in the first two modes; web search is gated the same way as a single switch.
- Settings → AI permissions: review and revoke the commands you've allowed or blocked, set the web-search switch, and reveal the on-device file where these decisions are stored.
- Refactored the internal engine-communication layer into smaller, single-responsibility modules — no functional change.
- Settings are organized into categories with a left navigation rail — Appearance, Startup & behavior, AI Assistant, Configuration, and Logging.
- Logs can be saved to a local file on demand, with automatic rotation and a size cap — kept entirely on your device, never uploaded.

## Fixed

- Connection info shows the real socket address (DOCKER_HOST) for every connection instead of a blank `unix://` — the per-connection socket resolved by the main process is now carried to the renderer in the runtime snapshot, and a live settings refresh can no longer erase a configured socket with an empty one.
- Live container logs no longer crash with "Cannot read properties of undefined (reading 'getApiDriver')" — the log stream now targets the container's own connection rather than an undefined global "current" engine; adapters built without a connection now fail with a clear message.
- Settings: the monospace-font picker keeps its filter input at the top (not the bottom) and caps the list to a compact height; the "Check for new versions" buttons now share the same size and render at equal height.

## [5.3.6] - 2026-06-19

## Fixed

- Packaged app no longer hangs at startup (blank window → 20s recovery dialog) when the GPU compositor is degraded. The Blueprint toaster is now created lazily on first use instead of at module scope with a top-level await that deadlocked the renderer boot chain.

## Changed

- Apple Container reuses the unified theme — removed its separate green accent and the "Green" theme option; only its brand logo keeps its color.
- Website: dropped the Apple Container swatch, screenshots and demo (Podman, Docker and unified only); the homepage no longer shows the "experimental" badge (kept in the manual), lists platforms as Linux · macOS · Windows, and the tagline reads "Container desktop companion".

## [5.3.5] - 2026-06-19

## Added

- **Container engine (macOS):** Manage Apple Container engines locally or over SSH through Socktainer.
- **Remote engines from `.env` (dev):** `CONTAINER_DESKTOP_REMOTE_<ID>_*` variables seed readonly Podman, Docker and Container SSH connections in `yarn dev`. Inert in production builds.
- Manual setup steps for macOS Container + Socktainer.

## Changed

- Apple Container is labeled **Container** in the app and docs.
- SSH remotes now follow OpenSSH host aliases, ssh-agent and default identities; `IdentityFile` is optional.

## Fixed

- Startup opens on the first available engine while remaining engines keep connecting in the background.
- Slow or stuck SSH/event/resource probes no longer leave the boot screen or sidebar spinner running forever.

## [5.3.4] - 2026-06-19

## Fixed

- Startup timing and window display
- The Registries screen loads its sources again instead of failing with an *Error fetching data* notification when engines are connected through the unified workspace.
- Data-fetch error notifications now name the failing resource and include the underlying error, instead of a bare *Error fetching data*.
- The app no longer flickers through a single-engine look (e.g. Docker) while engines finish connecting at startup — the theme stays settled until all configured engines report in.

## [5.3.3] - 2026-06-18

## Added

- Dedicated **Connections** screen for managing connections, viewing connection details and checking system information.
- **Unified** engine mode for mixed Podman and Docker sessions, with its own colors, logo and application icons.
- Per-connection **auto-reconnect** when an engine drops unexpectedly, with controls in user settings and per connection.

## Changed

- The app can connect to Podman and Docker together, show their resources in the same lists and keep each row clearly tied to its engine.
- Startup is more responsive when more than one engine is configured: available engines open the workspace even if another engine is offline.
- User settings is now focused on app preferences, while connection management lives in the Connections screen.
- The footer now groups connection status, theme switching and notifications in one place.
- The header, sidebar footer, connection selector and settings header have been tightened up for a cleaner, more consistent layout.
- The application logo, tray icon and taskbar icon now better match the active Podman, Docker or unified look where the platform supports it.
- The website now includes Podman, Docker and unified previews for the app theme.

## Fixed

- Auto-connect on startup, per-connection **Connect** buttons and sidebar navigation work reliably again.
- Container groups with the same name on different engines now remain separate instead of hiding or mixing rows.
- The connection selector now has consistent spacing, centered engine icons and a right-aligned caret across connection views.
- Header and footer icon buttons no longer show unwanted outlines in normal use.

## [5.3.2] - 2026-06-17

## Added

- `make release` — bump the version (commit, tag, push) and trigger the GitHub CDPipeline in one step.

## Changed

- Many visual fixes
- Documentation is now generated including screenshots and website player
- Version bumps no longer regenerate or commit the static website, and refuse to run when CHANGELOG.md [Unreleased] is empty. The documentation site is now rebuilt and committed at the end of CDPipeline — once the release assets exist — so its download links always match the published release.

## Security

- js-yaml updated to 4.2.0, fixing a quadratic-complexity denial-of-service in YAML merge-key handling (CVE-2026-53550). Build-tooling dependency, not shipped in the app.

## [5.3.1] - 2026-06-17

## Added

- Bulk (mass) operations on the list screens of Containers, Pods, Machines, Images, Volumes, Networks and Secrets — multi-select rows with delete and lifecycle actions (stop/pause/start/restart).
- System tray: a native menu for the current connection's containers, pods and machines with start/stop/pause/restart actions, built by the main process so it works with the main window closed (and reliable on Linux tray shells).

## Changed

- Notifications & activity log: the bell fills white when there are unread entries (counter badge removed); API response bodies and CLI output now show only for failed calls.
- Engine data and command execution are now owned by the main process and mirrored to every window, so the app and the tray share one engine connection and one source of truth.
- Redesigned the theme system around design tokens so all four combinations (Docker and Podman × dark and light) are visually coherent; light mode now uses neutral white/gray surfaces with the engine color (Docker blue, Podman purple) applied only as an accent on interactive elements instead of tinting whole surfaces.
- Modernized the renderer to the current Blueprint 6 component API (sizing via `size`, styles via `variant`, `endIcon`, `Alignment.START`/`END`, `PopoverNext`), removing all deprecated prop usage.
- The code editor (inspect/JSON, generate-kube) and the terminal/log views now follow the light/dark theme — light surfaces in light mode, the engine-tinted dark surface in dark mode — instead of always rendering dark.

## Fixed

- Terminal output no longer auto-linkifies URLs, so untrusted text (e.g. container logs) can no longer surface clickable links — removing a phishing vector.

## [5.3.0] - 2026-06-15

## Added

- Notification Center: a right-side panel opened from a bell in the footer, with a notifications history and a filterable Activity log of engine API and CLI interactions (friendly labels, status, duration, copy-as-cURL/command). In-memory only.
- Find in the current view with **Ctrl+F / Cmd+F** — a themed find widget (match counter, previous/next, case-sensitive) that highlights matches on container logs, inspect, processes and other detail and list views. JSON/YAML editors keep their built-in find, and list screens focus their existing filter box.
- Configurable monospace font in Settings (family, size and weight): choose any font installed on your system, or reset to the bundled font in one click.
- Testing foundation for the connection layer: a headless harness that runs the engine clients under Node, hermetic contract tests over the full engine × host matrix (Podman/Docker across native, WSL, LIMA, podman-machine and SSH) and the exact per-OS command/argv each transport builds, plus an SSH pre-flight diagnostic. A new **CIPipeline** workflow type-checks, lints, unit-tests and production-builds every PR, and runs the Go relay tests on both Linux and Windows and the Python tooling tests.
- Configurable **live connectivity suite** (`yarn test:live`) that exercises the real connection matrix against your own machines — Podman/Docker over native sockets, SSH remotes and WSL/LIMA/vendor scopes — declared in a gitignored targets file (template: `src/__tests__/live/targets.example.env`) and selected with `CONTAINER_DESKTOP_TEST_TARGETS`. Excluded from the hermetic/CI run; unconfigured combos are skipped, never silently passed.

## Changed

- Container logs now use a live stream for running containers instead of polling full log snapshots, and stopped containers load logs once until manually refreshed.
- The embedded terminal no longer recreates itself on every log update, preventing flicker and duplicate output.
- Build output is now version-scoped under `build/<version>/` with stable target filenames.
- Trimmed unused direct dependencies and removed the dead ncc single-file post-build step; ssh-related modules continue to be bundled by the Vite/Rolldown build.
- Resource detail and inspect views (containers, images, pods, volumes, networks, secrets) now refresh from engine events instead of a 2-second poll, and polling pauses while the window is in the background; the remaining polled views (stats, processes, machines) only refresh while visible.
- Container statistics are only polled while the container is running.
- The container logs view shows a live status pill (LIVE / CONNECTING / ENDED / SNAPSHOT) overlaid on the terminal in place of the status bar, and coalesces streamed output per animation frame to stay smooth under heavy logging.
- Bundled JetBrains Mono as the default monospace font for logs, terminals and data views, for consistent, readable rendering across platforms (overridable in Settings).
- WSL connections now use a lightweight stdio relay instead of running an SSH server inside the distribution; the injected helper is integrity-checked (SHA-256) before it runs. Podman Machine and Docker Desktop still connect directly through their host pipe.

## Fixed

- Container logs now decode Docker multiplexed stdout/stderr frames before writing to the terminal.
- The development watcher no longer deletes `preload.cjs` after the preload build completes.
- Monaco is bundled locally instead of being loaded from a CDN.
- Remote SSH on Linux and macOS now verifies host keys instead of disabling the check, preventing man-in-the-middle attacks.
- Remote SSH connections no longer hang indefinitely on "Please wait": the control connection is bounded (non-interactive, with a connect timeout) and a non-default SSH port is no longer dropped. When a connection fails, the app now reports the specific cause — missing ssh client, identity file not found, key permissions too open, host unreachable, or remote engine not running — instead of failing silently with no reason. The cause is shown in the Settings connection list, on the connection's Connect button and in the startup notification, naming the exact step that failed. (#171, #186)

## [5.2.16] - 2026-06-14

A large internal modernization of how the app talks to engines and manages state, plus user-facing list improvements.

## Added

- Sortable columns across every resource list.
- Live, event-driven lists: containers, images, pods, volumes and networks now update as the engine reports changes, with automatic reconnect and a polling fallback when events aren't available.
- Folder-style grouping for containers (groups first, cleaner names).

## Changed

- Re-architected the Podman/Docker runtime into small composable pieces (transport/dialect/profile) behind a single symmetric engine facade, so both engines share one consistent surface and connection/relay logic is no longer duplicated.
- Replaced the monolithic API client with typed per-resource adapters and per-engine normalizers.
- Overhauled state management: dropped Easy-Peasy and the hand-rolled refresh poller; live lists now come from event-backed stores while detail and mutation flows use TanStack Query re-entering a screen is instant from cache.
- Migrated routing from Wouter to TanStack Router.
- New libraries adopted: TanStack Query (request/mutation support), Zustand (app, UI and resource state), TanStack Router (routing), and Vitest (unit tests).
- Simplified packaging: Linux now ships only `tar.gz` (x64 and arm64); dropped AppImage, flatpak, rpm, deb and pacman. macOS is Apple Silicon (arm64) only; dropped Intel.

## Fixed

- Linux terminal launch no longer hangs.
- More honest connection handling: failed SSH connections are reported as failures, podman-machine startup no longer falsely reports success and lists no longer briefly flash another connection's data.

## 5.2.15 - 2025-04-01

## Changed

- Replaced `react-router-dom` with `wouter`
- Upgraded all dependencies

## 5.2.14 - 2024-12-31

## Changed

- Upgraded all dependencies

## 5.2.13 - 2024-10-15

## Added

- WSL: Relay method using custom ssh client + custom ssh server and windows named pipes
- Connection info screen - exemplify how to connect from code and with cli tools

## Changed

- Improved the way volume mounts are displayed
- Improved layers display (use `div` instead of a `textarea`)
- Default monospace font is now `Consolas, "SF Mono", "DejaVu Sans Mono", "Droid Sans Mono", "Ubuntu Mono", "Roboto Mono", "Fira Code", monospace, "Powerline Extra Symbols"`
- Improved environment variables display(Container Inspect)
- Windows is now using only named pipes for remote and WSL connections instead of TCP
- Linux and MacOS use relayed unix sockets instead of TCP

## 5.2.12 - 2024-10-10

## Added

- WSL - All relay binaries and build scripts

## 5.2.11 - 2024-10-08

## Changed

- WSL - Ensure `$HOME/.local/bin/container-desktop-wsl-relay` has executable permissions once deployed

## 5.2.10 - 2024-10-08

## Changed

- WSL - Use socat / local named pipe server instead of TCP to connect to a custom distribution
- Reduced default timeouts to 3 seconds

## 5.2.9 - 2024-10-07

## Changed

- WSL - Add `socat` retry mechanism for Docker engine

## 5.2.8 - 2024-10-07

## Changed

- WSL - Use custom `socat` relay build - deploy to WSL file-system before spawning to avoid `execvp` errors

## 5.2.7 - 2024-10-05

## Changed

- WSL - Drop custom relay in favor of custom `socat` build, relay using a node server listening on named pipe
- WSL - Use named pipes listener instead of random tcp localhost allocated port listener(more secure, avoid firewall prompts)
- Improve logging
- Improve spawned processes killing

## 5.2.6 - 2024-09-24

## Changed

- WSL - Create and use a custom TCP relay
- WSL - Performance - Reduced CPU usage to insignificant values during polling
- WSL - Provisioning - Removed the need for `socat` or `netcat` as the relay binary is now bundled for Windows

## Fixed

- Avoid reading container processes if container is not running

## Added

- WSL - Killing of spawned processes from WSL distribution before application graceful quit(nodejs cannot kill them as they are not native)
- WSL - Relay binary helper building during release

## 5.2.5 - 2024-09-24

## Fixed

- WSL - Fix never ending pollers due to netcat no timeout exit

## Changed

- Reduced the polling frequency to 2 seconds

## 5.2.4 - 2024-09-24

## Fixed

- WSL - Support for multiple distributions even with automatic connections
- Flatpak - Unable to set icon and connect properly
- Linux - Proper icons and logos in all cases for all packages
- Window Close issues

## Changed

- Reduced timeouts to fail faster
- Improved flatpak build process to be able to publish to flathub
- Updated deps

## Changed

## 5.2.3 - 2024-09-20

## Changed

- Completed rebranding - added container-desktop.com support
- Added separate UI and latest version checking API endpoint for supporting Microsoft Store for Windows as updates need approval
- Only build appx target by default in releases
- Podman machine info respects the cli
- Moved container stats to container actions menu to favor Processes
- Container pages auto-refresh on container start / stop / pause / restart
- Container playback actions differentiation
- Upgraded deps

## Added

- Issue #159: Ability to create and start multiple containers from the same image
- Processes top list page for a container
- Reload button for all container screens

## Fixed

- Docker engine discovery - now it is supposed to support any docker engine in existence using auto-detection (podman impersonating as docker is recognized on purpose as docker just like any other client that uses podman docker compatibility layer)
- Tray icon for mac is now theme aware and has proper size

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

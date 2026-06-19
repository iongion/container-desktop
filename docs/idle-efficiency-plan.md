# Idle Efficiency Remediation Plan

Status: proposed for review.

This plan targets the idle behavior observed while running `yarn dev` with the
current development engines, including the new Apple engine path. The goal is
maximum efficiency with the app still behaving like a live container dashboard:
no stale UI when real container state changes, but no repeated work when nothing
changes.

## Current Evidence

Running the development app shows very heavy repeated logs while the app is idle:

- SSH tunnel reuse messages repeat continuously.
- API proxy logs dump full connection, request, config, and Node agent objects.
- Node API drivers are created and logged repeatedly.
- The app icon and tray icon are refreshed periodically even when the selected
  icon does not change.
- Event stream requests reconnect roughly every few seconds, which causes `_ping`,
  `/events`, and sometimes `/containers/json` traffic even with no user action.

The most important root cause appears to be timeout handling in
`src/platform/node-executor.ts`: callers can request `timeout: 0` for long-lived
event streams, but the code currently uses `||` fallback defaults. That turns
`0` into `3000` or `5000`, so long-lived `/events` requests are accidentally
treated like short normal API calls. They time out, reconnect, probe the engine,
and repeat.

The second root cause is logging. `src/logger/index.ts` currently returns
`console` directly, so `debug` calls are not filtered. Several hot paths log full
class instances and HTTP agent internals, which makes each repeated request
expensive and unreadable.

The third root cause is broad change handling. `src/electron-shell/main.ts`
subscribes to every engine data change and refreshes the tray menu, tray icon,
and window icon together. Resource updates should not set the same icon again.

## Design Goals

- Idle must be quiet: after the initial connection settles, no repeated network
  calls except stable long-lived event streams and truly required health checks.
- Live behavior must stay live: external container/image/volume/network changes
  should update the UI quickly through engine events.
- Logs must be useful by default: no full object/class dumps, no HTTP agent dumps,
  and no hot-path debug output unless explicitly enabled.
- Work must be scoped: resource changes update resource views; icon changes update
  icons; tray menu changes update the tray menu.
- Polling is a fallback, not the default authority, and should be adaptive based
  on visibility, active screen, engine capability, and recent failures.

## Phase 1: Stop The Event Reconnect Loop

Fix timeout preservation in `src/platform/node-executor.ts`.

Required changes:

- Replace timeout fallback patterns like `request.timeout || defaultTimeout` with
  nullish fallback: `request.timeout ?? defaultTimeout`.
- Preserve `timeout: 0` for `/events` and any other intentional long-lived calls.
- Apply the same rule in the Node API driver, WSL proxy, and SSH proxy paths.
- Ensure event stream requests do not inherit short request defaults.

Expected result:

- A healthy engine keeps one long-lived `/events` request open.
- The app no longer does a periodic `_ping` plus `/events` reconnect cycle while
  idle.
- `EngineDataService.handleEventsDrop` only runs when the stream actually drops.

Tests:

- Add a unit test proving `timeout: 0` survives driver/proxy normalization.
- Add a regression test for event-stream request options if the existing test
  harness can observe them cleanly.

## Phase 2: Make Logging Cheap And Intentional

Replace the current logger shim with real level filtering.

Required changes:

- Make `createLogger()` return a logger that honors configured level.
- Default normal development output to `info` or `warn`; keep hot-path request
  traces behind `debug` or a more explicit flag such as
  `CONTAINER_DESKTOP_DEBUG_HTTP=1`.
- Keep errors and actionable warnings visible.
- Remove or guard `console.debug` usage in hot paths.

Logging shape:

- Log compact request summaries:
  - method
  - route/path
  - engine
  - connection id/name
  - host name
  - timeout
  - response type
- Do not log full `connection`, `config`, `request`, `httpAgent`,
  `httpsAgent`, socket, or Axios objects by default.
- Do not log entire JS class instances.

Candidate hot paths to clean:

- `src/platform/node-executor.ts`
- `src/container-client/runtimes/host-client.ts`
- `src/electron-shell/main.ts`
- `src/electron-shell/services.ts`
- any renderer code using `console.debug` during resource updates

Expected result:

- Idle logs become nearly empty after startup.
- When debugging is enabled, logs are structured and compact enough to read.

Tests:

- Add logger unit tests for level filtering.
- Add a small test or snapshot around request summary formatting so future code
  does not reintroduce object dumps.

## Phase 3: De-Duplicate Icon And Tray Work

Separate icon refresh from generic engine-data changes.

Required changes:

- Cache the last tray icon path in the tray controller and no-op when unchanged.
- Cache the last application/window icon path and no-op when unchanged.
- In `src/electron-shell/main.ts`, compute whether icon engine or theme changed
  before calling icon refresh methods.
- Decouple tray menu refresh from icon refresh.
- Avoid rebuilding the tray menu when the menu model is unchanged.

Expected result:

- No repeated `Set tray icon...` or `Updated application icon...` logs while idle.
- Resource changes do not reload identical image files.
- Tray menu still reflects real state changes.

Tests:

- Add unit tests for icon no-op behavior.
- Add a tray menu model signature test if the tray controller has a suitable
  seam for testing.

## Phase 4: Scope Resource Notifications

The main process already centralizes engine state through `EngineDataService`,
which is the right direction. The next step is to make notifications more
specific and cheaper.

Required changes:

- Keep the existing resource signature de-duplication, but avoid broadcasting full
  snapshots when nothing changed.
- Coalesce multiple resource changes into one renderer broadcast per tick or
  short debounce window.
- Consider separate notifications for:
  - runtime/connection status
  - container resources
  - image resources
  - volume resources
  - network resources
  - tray menu model changes
- Compute heavy snapshots lazily where possible.

Expected result:

- One engine event produces the minimum required UI update.
- A burst of engine events produces one coherent UI refresh instead of repeated
  full snapshots.
- Tray/menu/icon work is not attached to every resource notification.

Tests:

- Add tests around unchanged resource sets not emitting renderer sync updates.
- Add tests around burst coalescing if the implementation introduces a scheduler.

## Phase 5: Use Adaptive Live Data

The preferred live model should be:

1. Initial refresh after connection.
2. Long-lived engine event stream.
3. Targeted refresh for the affected domain when an event arrives.
4. Adaptive fallback only when events are unavailable or repeatedly failing.

Fallback polling policy:

- Poll only the domains needed by visible UI or tray features.
- Use slower intervals while the app is backgrounded or idle.
- Back off after failures.
- Stop polling an engine/domain that is disconnected or unavailable.
- Use health probes sparingly and only when they affect user-visible state.

Renderer query policy:

- Treat main-process resource sync as the authority for container resources.
- Avoid renderer polling for data already mirrored by `EngineDataService`.
- Keep polling only for genuinely live, screen-scoped data such as stats, logs,
  terminal sessions, or short-lived progress where events are not enough.

Production note:

- `src/web-app/Environment.ts` currently enables polling in production. Review
  whether that is still necessary once main-process resource sync is stable. If
  kept, it should be screen-scoped and idle-aware rather than global.

Expected result:

- The app remains live when containers are started/stopped outside the UI.
- Idle network and CPU usage stay low.
- Unhealthy remote engines do not create tight reconnect/probe loops.

Tests:

- Add an event-drop test that verifies reconnect backoff behavior.
- Add a visible-screen polling test if polling remains in any renderer queries.

## Phase 6: Measure And Gate Idle Behavior

Add a repeatable idle smoke test or script so regressions are visible.

Suggested smoke:

- Start `yarn dev`.
- Wait for initial connection/resource sync to settle.
- Observe 60 seconds of idle output.
- Assert:
  - no recurring `_ping` loop for healthy engines
  - no repeated `/events` reconnect loop
  - no repeated icon-set logs when icon inputs are unchanged
  - no full Agent/Axios/connection object dumps
  - no resource snapshot broadcasts when data signatures are unchanged

Manual verification:

- With Docker/Podman/Apple engines configured, leave the app idle for 60 seconds.
- Start or stop a container externally.
- Confirm the UI updates without manual refresh.
- Confirm logs remain compact and relevant.

Performance budget proposal:

- Idle CPU should settle near zero after startup on a healthy local/remote setup.
- Idle network should be limited to open event streams and rare backoff-aware
  health checks.
- The log stream should be quiet enough that a user can leave `yarn dev` open and
  immediately spot real warnings or errors.

## Acceptance Criteria

Implementation is complete when all of the following are true:

- A healthy event stream is not timed out by default request timeouts.
- Idle app logs do not repeat request/driver/tunnel/icon messages.
- Debug logs are level-gated and compact.
- No full JS class, Axios config, HTTP agent, or socket objects are logged by
  default.
- Tray and app icons are not refreshed unless their effective icon path changes.
- Tray menu refresh is de-duplicated or scoped to real menu model changes.
- Resource snapshots are not broadcast when data did not change.
- External container changes still appear in the UI quickly.
- Automated tests cover the timeout regression, logger level filtering, and icon
  de-duplication.

## Open Decisions

- Should tray menu contents update continuously while the menu is closed, or be
  rebuilt on menu open plus on major state transitions?
- Should development default log level be `info` or `warn`?
- Should HTTP request tracing use the normal log level system, a dedicated env
  flag, or both?
- What should the production fallback polling interval be for engines without a
  stable event stream?

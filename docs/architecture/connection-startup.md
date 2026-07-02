# ★ Connection Establishment at Startup

This is the most intricate flow in the app, and the one most worth understanding.
When container-desktop boots (or when you switch connections), it has to take a
**Connection** — *"Podman over SSH"*, *"Docker in WSL"*, *"Podman native"*, *"Apple
Container native"* — and turn it into a live, pingable engine API. The steps differ per host type, but the
**ordering is always the same**:

> **start the scope → detect settings → start the API → check availability**

Two layers cooperate: the **renderer** drives lifecycle and phase
([`stores/appStore.ts`](../../src/web-app/stores/appStore.ts)); the **backend**
composes and establishes the connection
([`Application.ts`](../../src/container-client/Application.ts)).

## Phases (renderer side)

`AppBootstrapPhase` ([`App.types.ts`](../../src/web-app/App.types.ts)) is the UI's
state machine. Only the bold transitions are exercised in practice.

```mermaid
stateDiagram-v2
  [*] --> INITIAL
  INITIAL --> STARTING: startApplication()
  STARTING --> READY: currentConnector.availability.api == true
  STARTING --> FAILED: unavailable or error
  READY --> STARTING: switch connection
  FAILED --> STARTING: retry
  READY --> STOPPING: disconnect
  STOPPING --> FAILED
```

While `STARTING`, the backend emits `startup.phase` traces ("Starting setup",
"Reading settings", "Listing connections", "Establishing connection", …) that the
bootstrap screen shows live.

## The end-to-end sequence

```mermaid
sequenceDiagram
  actor User
  participant UI as Renderer · appStore
  participant App as Application
  participant Host as HostClient
  participant Cmd as Command · preload/Node
  participant Eng as Engine API

  User->>UI: launch
  UI->>UI: waitForPreload() — poll window.Preloaded
  UI->>App: initialize() · getGlobalUserSettings()
  UI->>UI: startApplication() · phase = STARTING
  App->>App: setup() then stop() — clean slate
  UI->>App: getConnections() + getSystemConnections()
  Note over UI: pick default connector
  UI->>App: start({ connection, startApi })
  App->>Host: createComposedHostClient() — registry picks 3 units

  alt scoped host (machine / WSL / Lima / SSH)
    App->>Host: startScopeByName(scope)
    Host->>Cmd: start VM / wsl / SSH connection
  end

  App->>Host: getAutomaticSettings()
  Host->>Cmd: readEngineSocket (podman system info / docker context inspect)
  Cmd-->>Host: engine socket path
  Note over Host: getApiConnection() = scope URI + engine socket → { uri, relay }

  opt startApi (native/managed only)
    App->>Host: startApi()
    Host->>Cmd: spawn "podman system service (unix socket)"
  end

  App->>Host: getAvailability()
  Host->>Cmd: isApiRunning()
  Cmd->>Eng: GET /_ping
  Eng-->>Cmd: "OK"
  Cmd-->>Host: api = true
  Host-->>App: EngineConnectorAvailability
  App-->>UI: Connector (with availability)

  alt availability.api
    UI->>UI: phase = READY
    UI->>App: resourceEvents.start(id) — subscribe to engine events
  else
    UI->>UI: phase = FAILED — show settings + report
  end
```

The backend half (scope → settings → API → availability) is
`createConnectorContainerEngineHostClient()` in
[`Application.ts`](../../src/container-client/Application.ts); the renderer half is
`startApplication()` in [`appStore.ts`](../../src/web-app/stores/appStore.ts).

## How the scope & socket differ per host

The "establish scope / locate socket" step is the only part that varies. Each host
type's Transport implements it differently:

```mermaid
flowchart TB
  c["Connection (engine, host)"]:::component

  c --> native["native<br/>NativeTransport"]:::component
  c --> machine["machine / vendor<br/>PodmanMachineTransport"]:::component
  c --> wsl["WSL<br/>WSLTransport"]:::component
  c --> lima["Lima<br/>LIMATransport"]:::component
  c --> ssh["remote<br/>SSHTransport"]:::component

  native --> ns["no scope · engine runs on host<br/>unix socket directly"]:::external
  machine --> ms["podman machine · VM socket<br/>(npipe on Windows)"]:::external
  wsl --> ws["wsl.exe -d distro · Linux socket<br/>bridged via engine dial-stdio"]:::external
  lima --> ls["limactl shell instance · VM socket"]:::external
  ssh --> ss["SSH connection · remote socket<br/>bridged via engine dial-stdio"]:::external

  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

Notes per host:

- **native** ([`native.ts`](../../src/container-client/runtimes/transports/native.ts)) —
  no scope; for Podman, `startApi` spawns `podman system service … unix://<sock>`;
  Docker native has no managed service (the daemon is started outside the app).
  Apple Container (native + SSH-remote, macOS/Apple-silicon) likewise has no managed
  service — the user runs `container system start` + **socktainer**, whose
  `~/.socktainer/container.sock` is the Docker-compatible socket the app reaches.
- **machine / vendor** ([`podman-machine.ts`](../../src/container-client/runtimes/transports/podman-machine.ts)) —
  Podman machine VM; the socket comes from the machine. *(Docker's vendor host —
  Docker Desktop / Colima — is **unscoped** and uses the Native transport.)*
- **WSL** ([`wsl.ts`](../../src/container-client/runtimes/transports/wsl.ts)) —
  commands run via `wsl.exe -d <distro>`; the Windows side reaches the Linux socket
  through the engine's **`system dial-stdio` bridge** (below).
- **Lima** ([`lima.ts`](../../src/container-client/runtimes/transports/lima.ts)) —
  commands run via `limactl shell <instance>`.
- **remote / SSH** ([`ssh.ts`](../../src/container-client/runtimes/transports/ssh.ts)) —
  an SSH connection whose tunnel is brought up **lazily on first request**.

### SSH: the lazy tunnel

The SSH transport doesn't open the tunnel during settings detection — it injects a
`getSSHConnection` hook into the API driver, so the connection is established the
first time a request actually needs it. Only a `RUNNING`/`STARTED` status counts as
connected.

```mermaid
sequenceDiagram
  participant Host as HostClient (SSH)
  participant Cmd as Command · preload/Node
  participant Bridge as ssh port-forward (Linux/macOS) · SSHStdioBridgeServer (Windows)
  participant Remote as Remote host (sshd)
  participant Sock as Engine socket (remote)

  Note over Host: first API request triggers the tunnel
  Host->>Cmd: getApiDriver → getSSHConnection()
  Cmd->>Cmd: StartSSHConnection(sshHost)
  Cmd->>Bridge: start tunnel (ssh -NL · or ssh … engine system dial-stdio)
  Bridge->>Remote: connect · key auth · host key checked (accept-new / known_hosts)
  Remote->>Sock: dial unix socket
  Note over Host,Sock: tunnel up · local uri/npipe ↔ remote socket
  Host->>Cmd: ProxyRequest GET /containers/json
  Cmd->>Bridge: bytes over channel
  Bridge->>Sock: forward to engine socket
  Sock-->>Host: response
```

## Reaching a socket that isn't local

Two host families can't open the engine's unix socket directly, so the bytes are carried to
where the socket lives — by the **engine's own `docker`/`podman system dial-stdio`**, which
pumps a single stream to/from the socket. The app fronts a local pipe/socket and wires it to
that stdio stream; it no longer ships a byte-pump of its own. **No SSH server runs inside WSL,
and host keys are verified** (the old `:20022` sshd / `InsecureIgnoreHostKey` design is gone).

- **WSL (Windows)** — the app's `WSLRelayServer`
  ([`exec/wsl-relay.ts`](../../src/platform/exec/wsl-relay.ts)) listens on a Windows **named
  pipe** and, per connection, runs `wsl.exe --distribution <d> --exec <engine> system dial-stdio`
  inside the distro: named pipe ↔ `wsl.exe` stdio ↔ engine socket. No TCP listener, no SSH, no
  daemon left in the distro.
- **Remote SSH** — the lazy tunnel above. On **Linux/macOS** the app shells out to the OS
  `ssh` binary (`StrictHostKeyChecking=accept-new`, bounded connect, `-NL <local>:<remote>`),
  with a structured pre-flight
  ([`ssh-preflight.ts`](../../src/container-client/diagnostics/ssh-preflight.ts)) that explains
  failures instead of hanging. On **Windows** the app's `SSHStdioBridgeServer`
  ([`exec/ssh-stdio-bridge.ts`](../../src/platform/exec/ssh-stdio-bridge.ts)) fronts a named
  pipe and runs `<engine> system dial-stdio` on the remote over SSH, verifying `known_hosts`.

```mermaid
flowchart LR
  client["Engine API client<br/>(container-client)"]:::component
  pipe["Windows named pipe"]:::external
  server["WSLRelayServer<br/>(exec/wsl-relay.ts)"]:::container
  dial["engine system dial-stdio<br/>(via wsl.exe --exec)"]:::container
  sock["/run/.../podman.sock"]:::external

  client --> pipe --> server -->|wsl.exe --exec · stdio| dial --> sock

  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
  classDef container fill:#438dd5,color:#fff,stroke:#2e6295;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

## The availability gate

`getAvailability()` is the final verdict. It runs the checks **in order** and
records a `report` for each, so a `FAILED` connection tells you exactly which step
broke. Only a successful `GET /_ping` (response `"OK"`) flips `api` to true and the
phase to `READY`.

```mermaid
flowchart TB
  s([getAvailability]):::component --> host{host OS enabled?}
  host -->|no| F[FAILED<br/>report names the failing check]:::external
  host -->|yes| prog{program found?}
  prog -->|no| F
  prog -->|yes| scoped{scoped host?}
  scoped -->|yes| ctrl{controller and scope ok?}
  scoped -->|no| avail{api config present?}
  ctrl -->|no| F
  ctrl -->|yes| avail
  avail -->|no| F
  avail -->|yes| ping{GET /_ping == OK?}
  ping -->|no| F
  ping -->|yes| R[READY]:::system

  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
  classDef system fill:#1168bd,color:#fff,stroke:#0b4884;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

## Function reference (where to look)

| Step | Function · file |
| --- | --- |
| Wait for preload | `waitForPreload` · [`Native.ts`](../../src/web-app/Native.ts) |
| Renderer bootstrap | `initialize`, `startApplication` · [`appStore.ts`](../../src/web-app/stores/appStore.ts) |
| Backend entry | `start`, `createConnectorContainerEngineHostClient` · [`Application.ts`](../../src/container-client/Application.ts) |
| Compose client | `createComposedHostClient` · [`registry.ts`](../../src/container-client/runtimes/registry.ts) |
| Start scope | `startScopeByName` · transport (e.g. [`ssh.ts`](../../src/container-client/runtimes/transports/ssh.ts)) |
| Detect settings | `getAutomaticSettings`, `readEngineSocket`, `getApiConnection` · profile/dialect |
| Start API | `startApi`, `buildServiceArgs` · [`native.ts`](../../src/container-client/runtimes/transports/native.ts) + dialect |
| Availability | `getAvailability`, `isApiRunning` (`/_ping`) · [`host-client.ts`](../../src/container-client/runtimes/host-client.ts) |
| Live events | `resourceEvents.start` · [`stores/resourceEvents.ts`](../../src/web-app/stores/resourceEvents.ts) |

# Frontend — React Renderer (C4 L3)

The frontend is the React app in [`src/web-app/`](../../src/web-app/). It renders
the UI, holds client state, and drives the backend (the `container-client` engine
logic, which is bundled into the same renderer — see [overview.md](overview.md))
through a thin **Native bridge**.

Stack: **React 19** · **TanStack Router** (hash history, manual route tree) ·
**TanStack Query** (server-state cache) · **Zustand** (client state) ·
**Blueprint 6** (UI) · **xterm** + **monaco** (terminals / editors).

## C4 L3 — Components

```mermaid
flowchart TB
  user([Developer / Operator]):::person

  subgraph renderer[Renderer · web-app]
    direction TB
    boot["index.tsx → App.tsx<br/>AppMainScreen bootstrap"]:::component
    providers["Providers<br/>QueryClient · Helmet · i18n · Hotkeys"]:::component
    layout["AppLayout (router root)<br/>Header · Sidebar · Footer · &lt;Outlet/&gt;"]:::component
    screens["Screens<br/>Containers · Images · Pods · Volumes ·<br/>Networks · Secrets · Machines · Settings …"]:::component

    subgraph state[Zustand stores]
      direction TB
      appStore["appStore<br/>phase · connectors · connections · settings"]:::component
      resourceStore["resourceStore<br/>per-connection resource snapshots"]:::component
      resourceEvents["resourceEvents<br/>live engine event streams + polling"]:::component
      uiStore["uiStore · sortStore<br/>ephemeral / persisted UI"]:::component
    end

    query["TanStack Query<br/>queryClient · queries.ts · per-screen hooks"]:::component
    native["Native bridge<br/>Native.ts (waitForPreload) +<br/>Application.getInstance()"]:::component
  end

  backend["container-client (backend)<br/>Application / HostClient"]:::external
  bus["window.MessageBus · window.Command<br/>(preload bridge)"]:::external

  user --> boot --> providers --> layout --> screens
  boot --> appStore
  screens --> query
  screens --> uiStore
  query --> native
  appStore --> native
  resourceEvents --> resourceStore
  query -.->|invalidate on mutation| resourceEvents
  native --> backend
  native -.-> bus

  classDef person fill:#08427b,color:#fff,stroke:#052e56;
  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8;
  classDef external fill:#8a8a8a,color:#fff,stroke:#5e5e5e;
```

## The components

**Bootstrap** — [`index.tsx`](../../src/web-app/index.tsx) mounts the provider
stack (`QueryClientProvider` › `I18nContextProvider` › `HelmetProvider` › `App`).
[`App.tsx`](../../src/web-app/App.tsx) builds the TanStack **Router** (hash
history, explicit route tree) and an `AppLayout` root route that draws the
persistent chrome — header, sidebar, footer — around the routed `<Outlet/>`.
`AppMainScreen` kicks off the startup sequence (see
[connection-startup.md](connection-startup.md)).

**State — Zustand stores** ([`src/web-app/stores/`](../../src/web-app/stores/)),
each one concern:

| Store | Holds |
| --- | --- |
| `appStore` | bootstrap `phase`, `connectors` (availability matrix), `connections` (configured list), `currentConnector`, `userSettings`; the `initialize` / `startApplication` / connection-CRUD actions |
| `resourceStore` | per-connection snapshots of containers/images/pods/volumes/networks/secrets (items, loading, lastError, eventsConnected) |
| `resourceEvents` | live engine event subscriptions per connection, with fallback polling and reconnect |
| `uiStore` | ephemeral per-screen UI (search, selection, overlays); reset on connection switch |
| `sortStore` | sort specs, persisted to localStorage |

**Server state — TanStack Query** ([`src/web-app/domain/`](../../src/web-app/domain/)):
`queryClient.ts` configures a **cache-first** client (`staleTime: Infinity`); live
domains opt into `liveQueryOptions()` (short stale time + polling). Screen-level
`queries.ts` hooks call the backend and, on mutation, invalidate the cache and
nudge `resourceEvents` to resync.

**Native bridge** — [`Native.ts`](../../src/web-app/Native.ts) +
`Application.getInstance()`. `waitForPreload()` blocks until the preload has
exposed `window.Preloaded`; after that the renderer can construct the
`Application` singleton (which captures `window.MessageBus`) and call the backend.
This is the single seam between UI and engine logic.

## Screens

Screens live under [`src/web-app/screens/`](../../src/web-app/screens/), one folder
per domain. Each screen is a small contract: it exports a component plus
`Screen.ID`, `Screen.Title`, `Screen.Route`, and `Screen.Metadata` (icon), which
`App.tsx` registers as a route.

| Domain | Folder | Typical views |
| --- | --- | --- |
| Dashboard | `Dashboard/` | landing |
| Containers | `Container/` | manage · logs · inspect · stats · processes · terminal · kube |
| Images | `Image/` | manage · inspect · layers · security |
| Pods | `Pod/` | manage · logs · inspect · processes · kube |
| Machines | `Machine/` | manage · inspect |
| Networks | `Network/` | manage · inspect |
| Volumes | `Volume/` | manage · inspect |
| Secrets | `Secret/` | manage · inspect |
| Registries | `Registry/` | manage |
| Settings | `Settings/` | user settings · connection info · system info |
| Troubleshoot | `Troubleshoot/` | diagnostics |

Navigation helpers live in [`Navigator.ts`](../../src/web-app/Navigator.ts);
runtime config (environment, poll rate, doc links) in
[`Environment.ts`](../../src/web-app/Environment.ts).

## Source map

| Component | Path |
| --- | --- |
| Entry / providers | [`index.tsx`](../../src/web-app/index.tsx) |
| App / router / layout | [`App.tsx`](../../src/web-app/App.tsx) · [`App.types.ts`](../../src/web-app/App.types.ts) |
| Stores | [`stores/`](../../src/web-app/stores/) |
| Query layer | [`domain/queryClient.ts`](../../src/web-app/domain/queryClient.ts) · [`domain/queries.ts`](../../src/web-app/domain/queries.ts) |
| Native bridge | [`Native.ts`](../../src/web-app/Native.ts) |
| Navigation / env | [`Navigator.ts`](../../src/web-app/Navigator.ts) · [`Environment.ts`](../../src/web-app/Environment.ts) |
| Screens | [`screens/`](../../src/web-app/screens/) |

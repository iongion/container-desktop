---
os: using
osLabel: Using the app
osIcon: fa-book-open
iconClass: fas
order: 10
permalink: false
sections:
  - { id: using-notifications, label: "Notification center & activity log" }
  - { id: using-build, label: "Building images" }
  - { id: using-hooks, label: "Lifecycle hooks" }
---

<section class="guide-sec" id="using-notifications">

### Notification center &amp; activity log

Open it from the **bell** at the far-right of the footer. It is a right-side panel with two tabs:

- **Notifications** — a history of the toasts the app shows (connection changes, action results), so a message you missed is never lost.
- **Activity** — a live, filterable log of every interaction with your container engine: each **API** call (e.g. *List containers* → `GET /containers/json`) and every **CLI** command the app runs, with status, duration, and one-click **Copy as cURL** / **Copy command**.

Filter by text, by kind (API / CLI / System) or by severity; repeated calls collapse so the stream stays readable. Nothing is persisted — the log is in-memory for the current session, and you can pause or clear it from the panel header.

<div class="note info">

The Activity tab doubles as a **learning tool** — it shows exactly how Container Desktop drives Podman/Docker, so you can reproduce any action from a terminal.

</div>

</section>

<section class="guide-sec" id="using-build">

### Building images

Container Desktop builds container images for you — no terminal required. Open the **Build Studio** from the **Build image** button on the **Images** screen: author a Containerfile in the built-in editor (it **lints as you type**), set your tags, build args, target stage and platforms in the configuration panel, then hit **Build image** to run it on a native Podman or Docker engine. The **Build run** panel streams a **Timeline** — every step with a cache **hit / miss** badge and its duration — and, after a successful build, a **Layers** tab with a dive-style waterfall of the image's layers and sizes.

<img src="/img/podman/Build.png" alt="Building an image in the Build Studio" />

</section>

<section class="guide-sec" id="using-hooks">

### Lifecycle hooks

Run a command of your own before a container or a compose stack starts, or after it stops: mount a share, seed a database, take a backup. Add them in **Settings → Lifecycle hooks**: pick the container (by name) or the stack (by compose project), its connection, and a **Before start** and/or **After stop** command.

- A hook runs **on this computer, as you**, for every start and stop: from the screens, the tray, bulk actions, or an AI client through the MCP server. A restart counts as a start.
- A failing **Before start** hook cancels the start and says why; a failing **After stop** hook is only reported.
- A stack hook runs once around the stack's **Start all**, **Stop all** and **Restart all**, where each container's own hooks run too. **Import stack**, tearing a stack down, and starting or stopping its pod run only the stack hook.
- Removing or unpausing a container runs no hook.
- A hook is a program and its arguments, run without a shell (wrap it in `sh -c "…"` for pipes or redirects), for up to 60 seconds. It gets `CD_HOOK` (`before-start` / `after-stop`), `CD_CONTAINER_ID`, `CD_CONTAINER_NAME`, `CD_CONNECTION`, `CD_ENGINE`, and `CD_STACK` for a stack.

</section>

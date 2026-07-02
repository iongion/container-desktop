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

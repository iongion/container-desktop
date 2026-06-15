---
os: using
osLabel: Using the app
osIcon: fa-book-open
iconClass: fas
order: 10
permalink: false
sections:
  - { id: using-notifications, label: "Notification center & activity log" }
  - { id: using-logs, label: "Live container logs" }
  - { id: using-fonts, label: "Font settings" }
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

<section class="guide-sec" id="using-logs">

### Live container logs

For a **running** container, logs **stream live** and a status pill shows **LIVE / CONNECTING / ENDED / SNAPSHOT**. Stopped containers load their logs once — refresh to reload. Use **Ctrl / Cmd + F** to search within the log (see [Keyboard shortcuts](#shortcuts)).

</section>

<section class="guide-sec" id="using-fonts">

### Font settings

Logs, terminals and code views use a monospace font you can change in **Settings**: pick any family installed on your system (type to filter), set the size and weight, or reset to the bundled **JetBrains Mono**. Your choice applies everywhere instantly.

</section>

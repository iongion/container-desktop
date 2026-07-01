---
os: assistant
osLabel: AI Assistant
osIcon: fa-wand-magic-sparkles
iconClass: fas
order: 9
permalink: false
sections:
  - { id: assistant-what, label: "What it is" }
  - { id: assistant-model, label: "Choose your model" }
  - { id: assistant-do, label: "What it can do" }
  - { id: assistant-privacy, label: "Privacy & permissions" }
  - { id: assistant-generator, label: "Dockerfile & Compose generator" }
---

<section class="guide-sec" id="assistant-what">

### What it is

Container Desktop has a built-in **AI assistant** that understands your container setup and can inspect and operate it for you — in plain language. Ask *"why did my web container exit?"* or *"show me the running containers"* and it investigates and acts, right inside the app.

Open it from the **AI menu** in the header (the chat button — the caret beside it lists the Assistant and the generator). It is **local-first**: point it at a model running on your own machine and nothing leaves the device.

</section>

<section class="guide-sec" id="assistant-model">

### Choose your model

Pick your inference **source → provider → model** from the selector in the message box. Two kinds of source are supported:

- **Local (no API key, runs on your machine):** **LM Studio** and **llama.cpp**. Start the server, and the assistant lists its models — your prompts and container data never leave the device.
- **Cloud (needs an API key):** **OpenRouter**, **Anthropic**, **OpenAI**, **DeepSeek**, **GLM** and **MiniMax**. Add a key in **Settings → AI**; OpenRouter exposes many vendors' models behind one key.

<div class="note info">

Keys are stored in your operating system's **keychain** (encrypted at rest) and are only ever read in the background process — the interface never shows them back. A cloud model is only reached once you've added its key.

</div>

</section>

<section class="guide-sec" id="assistant-do">

### What it can do

The assistant doesn't just chat — it calls **typed tools** and renders the results as rich **cards** instead of walls of text:

- **Look:** list and inspect **containers, images, networks and volumes**, read a container's **logs**, and check its **stats** — shown as sortable tables, a log viewer, and state badges. These read-only actions run freely.
- **Act:** **start / stop / restart / pause / remove** a container, **pull** or **remove** an image, **remove** a network or volume. Every state-changing action **asks for your approval first** (see below).
- **Escape hatch:** for anything the typed tools don't cover, it can run a host command in a **sandbox** (no shell, scrubbed environment, output capped) — also gated by your approval.

</section>

<section class="guide-sec" id="assistant-privacy">

### Privacy &amp; permissions

You decide what the assistant is allowed to run. The mode dropdown in the message box has three settings:

- **Always ask** — every state-changing action surfaces an **Allow / Reject** card; nothing is remembered.
- **Ask and remember** — approve (or decline) once, and that exact action is remembered so it won't ask again.
- **Always allow** — no prompts. Only choose this on a machine you fully trust.

A reject **never** runs. Review or revoke everything you've remembered — and the web-search switch — under **Settings → AI permissions**.

<div class="note info">

**Local-first and private by design.** Secrets (API keys, tokens) are **redacted** out of anything the model sees, and out of command output before it's read back. With a local model, your prompts and container details stay on your machine; a cloud model is only contacted after you've explicitly added its key.

</div>

</section>

<section class="guide-sec" id="assistant-generator">

### Dockerfile &amp; Compose generator

A second AI screen (the caret in the header AI menu) **drafts a Dockerfile or a Compose file** from a short description and a starter template, streamed as it writes, ready to copy or save. Same model picker, same privacy rules.

</section>

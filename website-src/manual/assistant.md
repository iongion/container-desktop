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
  - { id: assistant-runs, label: "Where it runs" }
  - { id: assistant-plugins, label: "Plugins & commands" }
  - { id: assistant-privacy, label: "Privacy & permissions" }
---

<section class="guide-sec" id="assistant-what">

### What it is

Container Desktop has a built-in **AI assistant** that understands your container setup and can inspect and operate it for you — in plain language. Ask *"why did my web container exit?"* or *"show me the running containers"* and it investigates and acts, right inside the app.

Open it from the **AI menu** in the header (the chat button). It is **local-first**: point it at a model running on your own machine and nothing leaves the device.

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
- **Files:** read, write and edit files, list a directory, search text, and run commands in the **workspace folder** you pick for the session.
- **Escape hatch:** for anything the typed tools don't cover, it can run a host command in a **sandbox** (no shell, scrubbed environment, output capped) — also gated by your approval.

</section>

<section class="guide-sec" id="assistant-runs">

### Where it runs

The assistant runs **inside a container** on one of your engine connections, not in the app. You start a session by picking that connection and a **workspace folder** from your machine, which is mounted into the container as the one folder its file and command tools can reach.

- **Your key never enters it.** Inference goes through a second, separate container that holds the provider credential; the agent container has no key, no access to your keychain and no route to your provider except through that proxy.
- **Sign in instead of pasting a key.** Where the provider offers it, **Settings → AI** runs that provider's own sign-in — in a throwaway container, because the sign-in needs one — and stores what it returns in your OS keychain. A sign-in that expires is **renewed for you**, before it lapses and without interrupting the conversation.
- **Network access is yours to give.** Leave it on so package managers work, or turn it off for a session and only the inference proxy stays reachable.
- **The container is disposable, the folder is not.** Stopping a session removes the pair; your workspace is a normal folder on your machine and whatever the assistant wrote is simply there. **Workspace changes** shows you exactly what it touched, as a Git status and diff.
- **Change the model mid-conversation** from the chip in the message box: the session, the containers and everything installed in them survive it, and a reasoning model's **thinking level** is offered when its provider says it has one.
- **Give the assistant a second container to work in**, if you want it acting somewhere other than its own: on the start form, choose an **existing container** on that connection — picked from a list of what is actually running, with its image and id — or a **disposable one** created from an image and removed when the session ends. Every file write and command there asks first.

</section>

<section class="guide-sec" id="assistant-plugins">

### Plugins &amp; commands

The assistant is a GUI for the [pi](https://github.com/earendil-works/pi) coding agent, so pi's own ecosystem works here.

- **Plugins** install from **npm or a Git URL** on the **Plugins** screen — reachable from the **AI menu** — and stay installed across sessions. What a plugin contributes (extra commands, skills and prompts) appears in the message box's slash-command palette, and anything it asks you is shown as a native dialog rather than terminal text.
- **Slash commands** cover the session itself: start a new one, compact the context, review project trust, look something up in the built-in troubleshooting notes, or save the whole conversation as a single standalone **HTML file**. They are pi's commands under pi's names, so [pi's own documentation](https://github.com/earendil-works/pi) applies here unchanged.
- **Skills** are reusable prompt-backed workflows you invoke by name; the app checks a skill's fingerprint and your project's trust before it runs one.

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

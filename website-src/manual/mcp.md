---
os: mcp
osLabel: AI clients (MCP)
osIcon: fa-plug
iconClass: fas
order: 9
permalink: false
sections:
  - { id: mcp-what, label: "What it is" }
  - { id: mcp-enable, label: "Turn it on" }
  - { id: mcp-http, label: "Connect a client" }
  - { id: mcp-stdio, label: "Clients that only speak stdio" }
  - { id: mcp-access, label: "What clients may do" }
  - { id: mcp-assistant, label: "After the old assistant" }
---

<section class="guide-sec" id="mcp-what">

### What it is

Container Desktop includes an **MCP server**, so the AI tool you already use (Claude Code, Cursor, VS Code, or any client that speaks the [Model Context Protocol](https://modelcontextprotocol.io)) can list, inspect and, if you allow it, manage your containers through the app, across every engine connection you have.

It listens on **this computer only** (`127.0.0.1`), answers only requests carrying its token, and is **off until you turn it on**.

</section>

<section class="guide-sec" id="mcp-enable">

### Turn it on

Open **Settings → MCP server** and switch it **On**. The panel then shows:

- the **endpoint**, `http://127.0.0.1:17627/mcp` unless you change the port;
- the **token** clients must send, with a copy button;
- **Regenerate token** in the menu beside it: every client still holding the old token stops working until you give it the new one.

The token is kept in your operating system's keychain (macOS Keychain, Windows Credential Manager, or the Secret Service on Linux). A machine without one cannot run the server yet; the status line says so.

</section>

<section class="guide-sec" id="mcp-http">

### Connect a client

Clients that speak HTTP connect straight to the endpoint with the token as a bearer header. Claude Code, for example:

```bash
claude mcp add --transport http container-desktop http://127.0.0.1:17627/mcp \
  --header "Authorization: Bearer <token>"
```

For a client configured through JSON, the same in its own format:

```json
{
  "mcpServers": {
    "container-desktop": {
      "type": "http",
      "url": "http://127.0.0.1:17627/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

</section>

<section class="guide-sec" id="mcp-stdio">

### Clients that only speak stdio

Some clients only start a program and talk to it over its standard input and output. Point them at the Container Desktop program with `--mcp-stdio`: it relays to the running app, finds the port in your settings and the token in the keychain, and opens no window.

```bash
claude mcp add container-desktop -- "<path to the Container Desktop program>" --mcp-stdio
```

```json
{
  "mcpServers": {
    "container-desktop": {
      "command": "<path to the Container Desktop program>",
      "args": ["--mcp-stdio"]
    }
  }
}
```

The app must be running with the server on: otherwise every request gets an error saying so.

</section>

<section class="guide-sec" id="mcp-access">

### What clients may do

**Access** in the panel decides it, and applies to the very next request:

- **Read-only** (the default): list connections, list and inspect containers, images, networks and volumes, read container logs and stats. Nothing changes.
- **Allow changes**: also start, stop, restart, pause, resume and remove containers, remove images, networks and volumes, and pull images.

In read-only a client still sees the changing tools, but a call to one is refused with an explanation of where to allow changes. Switching Access needs no reconnect: the next call already follows it. Anything a client changes shows in the app at once, and secrets are redacted from everything the server returns.

</section>

<section class="guide-sec" id="mcp-assistant">

### After the old assistant

Versions 6.0 and 6.1 had a built-in AI assistant; it is gone, and the MCP server takes its place. What it left behind stays where it was, untouched, for you to keep or remove:

- the `ai` block in `user-settings.json`, and `ai-permissions.json` and the conversations folder, in the app's data folder;
- `agent/` and `keychain-fallback.json` in the same folder, which can hold provider keys: delete them if you no longer need those keys;
- provider keys in your OS keychain, under the service `com.iongion.container-desktop.keychain`, removable with your keychain's own tool;
- the assistant's images, containers and plugin volume on your engines, removable from the app like any other.

</section>

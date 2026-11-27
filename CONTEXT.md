# Container Desktop MCP

The app's MCP server lets an AI client work with the user's container engines through the same engine service the UI
uses, on this computer only.

## Language

**MCP server**:
The part of Container Desktop that answers AI clients: a loopback listener in the Tauri shell, whose requests the
webview answers. Off by default.
_Avoid_: assistant, agent, bridge

**Client**:
An AI application that connects to the MCP server, such as Claude Code, Cursor or VS Code.
_Avoid_: agent, user

**Tool**:
One engine operation the server offers a client, such as `listContainers` or `stopContainer`, with a typed input
schema and annotations saying whether it changes anything.
_Avoid_: command, action, function

**Gated tool**:
A tool that changes an engine (start, stop, pause, restart, remove, pull). Only the **allow** mode lists and runs it.
_Avoid_: dangerous tool, write tool

**Mode**:
The user's choice of what clients may do: **read-only** (the default: list, inspect, read logs) or **allow** (gated
tools too). Read from the settings for every request.
_Avoid_: permission profile, approval mode, access level

**Token**:
The bearer secret a client presents on every request: 32 random bytes as hex, kept in the OS keychain. Regenerating it
cuts off every client still holding the old one.
_Avoid_: API key, password

**Transport**:
How a client reaches the server: **Streamable HTTP** at `http://127.0.0.1:<port>/mcp`, or **stdio** through
`container-desktop --mcp-stdio`, which relays to that endpoint and so needs the app running.
_Avoid_: channel, connection (a connection is an engine connection)

## Relationships

- A **Client** reaches the **MCP server** over one **Transport** and presents the **Token**.
- The **Mode** decides which **Tools** run; a **Client** sees every **Tool**, and a **Gated tool** is refused in
  read-only.
- Every **Tool** acts on an engine connection of the app; left unnamed, the current one (`current` in
  `listConnections`).

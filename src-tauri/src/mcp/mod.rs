// The MCP server's native half: a loopback HTTP listener whose requests the webview answers. The protocol, the tools
// and the permission mode live in TS (@/mcp-server, wired by src/packages/platform/src/tauri/mcpHost.ts); this side
// owns the socket, the request rules, and the bearer token kept in the OS keychain. `container-desktop --mcp-stdio`
// relays a stdio-only client to the same endpoint.

pub mod commands;
mod pending;
mod rules;
mod server;
mod settings;
pub mod stdio;
mod token;

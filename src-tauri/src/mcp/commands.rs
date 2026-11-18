// The MCP server's Tauri commands. `mcp_start`, `mcp_stop` and `mcp_status` run the listener from the settings;
// `mcp_reply` carries the webview's answer back to the request waiting for it. `mcp_token` and
// `mcp_regenerate_token` are the only way the webview reads the token: no command reads a stored secret in general.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::pending::PendingReplies;
use super::rules::MCP_PATH;
use super::server::{self, Forwarder, RunningServer, ServerConfig};
use super::settings::MIN_MCP_PORT;
use super::token::{ensure_token, replace_token, KeychainTokenStore, Token};

/// The event the webview answers (src/packages/platform/src/tauri/mcpHost.ts).
pub const MCP_REQUEST_EVENT: &str = "mcp://request";
// pullImage can take minutes; a request still unanswered after this gets a 504.
const REPLY_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MODES: [&str; 2] = ["read-only", "allow"];

#[derive(Default)]
pub struct McpState {
    pending: Arc<PendingReplies>,
    lifecycle: tokio::sync::Mutex<Lifecycle>,
}

#[derive(Default)]
struct Lifecycle {
    server: Option<RunningServer>,
    // Shown in the status only: the webview reads the mode from the settings for every request.
    mode: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Lifecycle {
    fn status(&self) -> McpStatus {
        let port = self.server.as_ref().map(|server| server.port);
        McpStatus {
            running: port.is_some(),
            port,
            url: port.map(|port| format!("http://127.0.0.1:{port}{MCP_PATH}")),
            mode: self.mode.clone(),
            error: self.error.clone(),
        }
    }
}

#[derive(Clone, Serialize)]
struct McpRequest {
    id: u64,
    body: String,
}

struct WebviewForwarder(AppHandle);

impl Forwarder for WebviewForwarder {
    fn forward(&self, id: u64, body: String) -> Result<(), String> {
        self.0
            .emit_to(crate::MAIN_WINDOW, MCP_REQUEST_EVENT, McpRequest { id, body })
            .map_err(|e| e.to_string())
    }
}

async fn keychain_token(allow_degraded: bool, replace: bool) -> Result<Token, String> {
    tokio::task::spawn_blocking(move || {
        let store = KeychainTokenStore { allow_degraded };
        if replace {
            replace_token(&store)
        } else {
            ensure_token(&store)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn serve(app: &AppHandle, state: &McpState, port: u16, token: Token) -> Result<RunningServer, String> {
    let config = ServerConfig {
        token,
        pending: Arc::clone(&state.pending),
        forwarder: Arc::new(WebviewForwarder(app.clone())),
        reply_timeout: REPLY_TIMEOUT,
    };
    server::start(port, config).await
}

async fn launch(app: &AppHandle, state: &McpState, port: u16, allow_degraded: bool) -> Result<RunningServer, String> {
    if port < MIN_MCP_PORT {
        return Err(format!("The MCP server's port must be between {MIN_MCP_PORT} and 65535"));
    }
    let token = keychain_token(allow_degraded, false).await?;
    serve(app, state, port, token).await
}

/// Listen on `port`. Already listening there: nothing restarts, only the mode shown in the status changes. A failure
/// (port taken, token not storable) is returned and kept in the status; the app runs on either way.
#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    state: State<'_, McpState>,
    port: u16,
    mode: Option<String>,
    allow_degraded: Option<bool>,
) -> Result<McpStatus, String> {
    let mut lifecycle = state.lifecycle.lock().await;
    lifecycle.mode = Some(mode.filter(|mode| MODES.contains(&mode.as_str())).unwrap_or_else(|| MODES[0].into()));
    if lifecycle.server.as_ref().is_some_and(|server| server.port == port) {
        return Ok(lifecycle.status());
    }
    if let Some(server) = lifecycle.server.take() {
        server.stop().await;
    }
    match launch(&app, &state, port, allow_degraded.unwrap_or(false)).await {
        Ok(server) => {
            lifecycle.server = Some(server);
            lifecycle.error = None;
            Ok(lifecycle.status())
        }
        Err(error) => {
            lifecycle.error = Some(error.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn mcp_stop(state: State<'_, McpState>) -> Result<McpStatus, String> {
    let mut lifecycle = state.lifecycle.lock().await;
    if let Some(server) = lifecycle.server.take() {
        server.stop().await;
    }
    lifecycle.mode = None;
    lifecycle.error = None;
    Ok(lifecycle.status())
}

#[tauri::command]
pub async fn mcp_status(state: State<'_, McpState>) -> Result<McpStatus, String> {
    Ok(state.lifecycle.lock().await.status())
}

/// The webview's answer to request `id`; an empty body means "nothing to say" (202). False when nothing waits.
#[tauri::command]
pub async fn mcp_reply(state: State<'_, McpState>, id: u64, body: String) -> Result<bool, String> {
    Ok(state.pending.resolve(id, body))
}

/// The token, created and stored first when there is none yet, for the settings to show and copy.
#[tauri::command]
pub async fn mcp_token(allow_degraded: Option<bool>) -> Result<String, String> {
    Ok(keychain_token(allow_degraded.unwrap_or(false), false).await?.expose().to_string())
}

/// A new token, stored in place of the old one. A running listener restarts on the same port, so no connection made
/// with the old token survives.
#[tauri::command]
pub async fn mcp_regenerate_token(
    app: AppHandle,
    state: State<'_, McpState>,
    allow_degraded: Option<bool>,
) -> Result<String, String> {
    let mut lifecycle = state.lifecycle.lock().await;
    let token = keychain_token(allow_degraded.unwrap_or(false), true).await?;
    if let Some(server) = lifecycle.server.take() {
        let port = server.port;
        server.stop().await;
        match serve(&app, &state, port, token.clone()).await {
            Ok(server) => lifecycle.server = Some(server),
            Err(error) => lifecycle.error = Some(error),
        }
    }
    Ok(token.expose().to_string())
}

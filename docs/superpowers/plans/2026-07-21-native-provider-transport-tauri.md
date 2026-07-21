# Native Provider Transport (Tauri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AI provider HTTPS call into Rust on the Tauri shell so the provider API key never enters the webview's JavaScript realm.

**Architecture:** The existing `ProviderTransport` port already carries a *credential reference* (provider id, origin, auth scheme) rather than a secret, so this adds a second implementation of that port instead of changing any contract. A new Rust command resolves the key from the OS keychain, applies the auth-scheme headers, validates the destination origin, issues the request with redirects disabled, and streams raw response bytes back over a Tauri `Channel`. The TypeScript side keeps timeout, response cap and abort.

**Tech Stack:** Rust (Tauri 2, reqwest 0.13 with `stream` + `rustls`), TypeScript, Vitest, WebdriverIO.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-21-native-provider-transport-design.md`.
- Node 24.16.0 (`nvm use`), yarn 1.x. Verify with `yarn check-types`, `yarn lint:check`, `yarn test:run`.
- Biome only, 2-space indent, double quotes, width 120. `yarn lint` auto-fixes.
- Comments use `//`. No ASCII divider comments. No block comments. No comments describing history or migration.
- Do NOT bump the app version. CHANGELOG entries only, terse and user-facing.
- No co-author or tooling attribution trailers in commits.
- Rust tests are run by hand: `cargo test --manifest-path src-tauri/Cargo.toml`. Do NOT add a cargo step to `.github/workflows/*.yml`.
- Rust unit tests target private free functions, not `#[tauri::command]` wrappers — keep commands thin (pattern: `src-tauri/src/keychain.rs:218`).
- Never patch, fork or edit `@open-multi-agent/core`.
- Tauri has no CDP. Live verification uses `yarn test:e2e:tauri` (WebDriver), never `support/cdp.mjs`.

---

### Task 1: Rust auth-header mapping and origin validation

Pure logic first, with no Tauri or network dependency, so it is unit-testable exactly like `keychain.rs`.

**Files:**
- Create: `src-tauri/src/provider_transport.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod provider_transport;` alongside the other `mod` declarations)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `pub(crate) struct CredentialRef { provider_id: String, provider_kind: String, origin: String, auth: AuthSettings }`, `pub(crate) struct AuthSettings { scheme: String, username: Option<String>, header_name: Option<String> }`, `fn validate_origin(raw_url: &str, origin: &str) -> Result<reqwest::Url, String>`, `fn auth_headers(credential: &CredentialRef, secret: Option<&str>) -> Result<Vec<(String, String)>, String>`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/provider_transport.rs` containing ONLY the test module and the type/function signatures needed to compile:

```rust
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct AuthSettings {
    pub scheme: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(rename = "headerName", default)]
    pub header_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct CredentialRef {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "providerKind")]
    pub provider_kind: String,
    pub origin: String,
    pub auth: AuthSettings,
}

// Header names a custom-header scheme may never set, mirroring FORBIDDEN_CUSTOM_AUTH_HEADERS in
// src/packages/platform/src/providerTransport/fetchProviderTransport.ts.
const FORBIDDEN_CUSTOM_AUTH_HEADERS: [&str; 7] = [
    "connection",
    "content-length",
    "cookie",
    "host",
    "proxy-authorization",
    "set-cookie",
    "transfer-encoding",
];

fn validate_origin(_raw_url: &str, _origin: &str) -> Result<reqwest::Url, String> {
    unimplemented!()
}

fn auth_headers(_credential: &CredentialRef, _secret: Option<&str>) -> Result<Vec<(String, String)>, String> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credential(scheme: &str, kind: &str) -> CredentialRef {
        CredentialRef {
            provider_id: "openai".into(),
            provider_kind: kind.into(),
            origin: "https://api.openai.com".into(),
            auth: AuthSettings { scheme: scheme.into(), username: None, header_name: None },
        }
    }

    #[test]
    fn rejects_a_url_whose_origin_is_not_the_bound_endpoint() {
        let err = validate_origin("https://attacker.example/v1/messages", "https://api.openai.com").unwrap_err();
        assert!(err.contains("does not match"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_non_http_scheme_and_embedded_credentials() {
        assert!(validate_origin("file:///etc/passwd", "file://").is_err());
        assert!(validate_origin("https://user:pass@api.openai.com/v1", "https://api.openai.com").is_err());
    }

    #[test]
    fn accepts_a_url_on_the_bound_origin() {
        let url = validate_origin("https://api.openai.com/v1/chat", "https://api.openai.com").unwrap();
        assert_eq!(url.path(), "/v1/chat");
    }

    #[test]
    fn keyless_providers_get_no_auth_header_and_need_no_secret() {
        let headers = auth_headers(&credential("none", "local"), None).unwrap();
        assert!(headers.is_empty());
    }

    #[test]
    fn anthropic_bearer_uses_x_api_key_and_others_use_authorization() {
        let anthropic = auth_headers(&credential("bearer", "anthropic"), Some("sk-a")).unwrap();
        assert_eq!(anthropic, vec![("x-api-key".to_string(), "sk-a".to_string())]);

        let openai = auth_headers(&credential("bearer", "openai"), Some("sk-o")).unwrap();
        assert_eq!(openai, vec![("authorization".to_string(), "Bearer sk-o".to_string())]);
    }

    #[test]
    fn basic_scheme_base64_encodes_username_and_secret() {
        let mut cred = credential("basic", "openai-compatible");
        cred.auth.username = Some("alice".into());
        let headers = auth_headers(&cred, Some("hunter2")).unwrap();
        // base64("alice:hunter2")
        assert_eq!(headers, vec![("authorization".to_string(), "Basic YWxpY2U6aHVudGVyMg==".to_string())]);
    }

    #[test]
    fn custom_header_scheme_refuses_a_forbidden_header_name() {
        let mut cred = credential("header", "openai-compatible");
        cred.auth.header_name = Some("Host".into());
        assert!(auth_headers(&cred, Some("secret")).is_err());
    }

    #[test]
    fn a_scheme_that_needs_a_secret_fails_without_one() {
        assert!(auth_headers(&credential("bearer", "openai"), None).is_err());
    }
}
```

Add the module declaration to `src-tauri/src/lib.rs` next to the existing `mod` lines:

```rust
mod provider_transport;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml provider_transport`
Expected: FAIL — the tests panic with `not implemented`.

- [ ] **Step 3: Implement the two functions**

Replace the two `unimplemented!()` bodies in `src-tauri/src/provider_transport.rs`:

```rust
// The request URL is renderer-supplied, so it is pinned to the origin the provider was configured with before
// any secret is attached. Mirrors assertBoundEndpoint in fetchProviderTransport.ts.
fn validate_origin(raw_url: &str, origin: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url).map_err(|_| "AI: invalid provider endpoint".to_string())?;
    let scheme = url.scheme();
    if (scheme != "http" && scheme != "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("AI: invalid provider endpoint".to_string());
    }
    if url.origin().ascii_serialization() != origin {
        return Err("AI: provider request does not match the configured endpoint".to_string());
    }
    Ok(url)
}

fn auth_headers(credential: &CredentialRef, secret: Option<&str>) -> Result<Vec<(String, String)>, String> {
    if credential.auth.scheme == "none" {
        return Ok(Vec::new());
    }
    let secret = secret.ok_or_else(|| "AI: no credential stored for this provider".to_string())?;
    match credential.auth.scheme.as_str() {
        "bearer" => Ok(vec![if credential.provider_kind == "anthropic" {
            ("x-api-key".to_string(), secret.to_string())
        } else {
            ("authorization".to_string(), format!("Bearer {secret}"))
        }]),
        "basic" => {
            let raw = format!("{}:{}", credential.auth.username.as_deref().unwrap_or(""), secret);
            Ok(vec![("authorization".to_string(), format!("Basic {}", base64_encode(raw.as_bytes())))])
        }
        "header" => {
            let name = credential.auth.header_name.as_deref().unwrap_or("").trim().to_string();
            if name.is_empty() || FORBIDDEN_CUSTOM_AUTH_HEADERS.contains(&name.to_lowercase().as_str()) {
                return Err("AI: invalid custom provider auth header".to_string());
            }
            Ok(vec![(name, secret.to_string())])
        }
        _ => Err("AI: unsupported provider auth scheme".to_string()),
    }
}
```

`keychain.rs` already base64-encodes for its fallback file. Check which crate it uses with
`/usr/bin/grep -n "base64" src-tauri/src/keychain.rs src-tauri/Cargo.toml`. If a `base64` crate is present, use it
directly and delete the `base64_encode` helper below; otherwise add this private helper to `provider_transport.rs`:

```rust
// Minimal base64 for the Basic scheme, so this module adds no dependency.
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml provider_transport`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/provider_transport.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): validate provider origin and map auth schemes natively"
```

---

### Task 2: Rust streaming command

**Files:**
- Modify: `src-tauri/src/provider_transport.rs`
- Modify: `src-tauri/src/lib.rs` (register commands in `tauri::generate_handler!`, add `.manage(...)`)

**Interfaces:**
- Consumes: `CredentialRef`, `validate_origin`, `auth_headers` from Task 1.
- Produces: commands `provider_transport_request(payload: ProviderRequestPayload, channel: Channel<InvokeResponseBody>, state: State<'_, ProviderTransportState>) -> Result<ProviderResponseHandle, String>` and `provider_transport_destroy(stream_id: String, state: State<'_, ProviderTransportState>)`. `ProviderResponseHandle` serialises as `{ streamId, status, statusText, headers }`.

- [ ] **Step 1: Add the payload, handle, state and command**

Append to `src-tauri/src/provider_transport.rs`:

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::async_runtime::{self, JoinHandle};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

#[derive(Deserialize)]
pub(crate) struct ProviderRequestPayload {
    pub credential: CredentialRef,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<Vec<u8>>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderResponseHandle {
    pub stream_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
}

#[derive(Default)]
pub(crate) struct ProviderTransportState {
    streams: Mutex<HashMap<String, JoinHandle<()>>>,
    counter: Mutex<u64>,
}

impl ProviderTransportState {
    fn next_id(&self) -> String {
        let mut counter = self.counter.lock().unwrap();
        *counter += 1;
        format!("ai-{counter}")
    }
    fn register(&self, id: String, handle: JoinHandle<()>) {
        self.streams.lock().unwrap().insert(id, handle);
    }
    fn remove_and_abort(&self, id: &str) {
        if let Some(handle) = self.streams.lock().unwrap().remove(id) {
            handle.abort();
        }
    }
}

// Control events cross the Channel as JSON; body chunks cross as InvokeResponseBody::Raw. The response body is
// opaque bytes, so a utf8 conversion would corrupt any codepoint split across a chunk boundary.
#[derive(Serialize)]
struct StreamEvent {
    #[serde(rename = "streamId")]
    stream_id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
}

impl StreamEvent {
    fn end(stream_id: &str) -> InvokeResponseBody {
        Self { stream_id: stream_id.into(), event_type: "end".into(), payload: None }.into_ipc()
    }
    fn error(stream_id: &str, message: String) -> InvokeResponseBody {
        Self {
            stream_id: stream_id.into(),
            event_type: "error".into(),
            payload: Some(serde_json::json!({ "message": message })),
        }
        .into_ipc()
    }
    fn into_ipc(self) -> InvokeResponseBody {
        InvokeResponseBody::Json(serde_json::to_string(&self).unwrap_or_else(|_| "{}".to_string()))
    }
}

/// Issue the provider request with the key resolved natively, and stream the raw response body back.
/// The key is read here and never returned to the webview.
#[tauri::command]
pub async fn provider_transport_request(
    payload: ProviderRequestPayload,
    channel: Channel<InvokeResponseBody>,
    state: State<'_, ProviderTransportState>,
) -> Result<ProviderResponseHandle, String> {
    let url = validate_origin(&payload.url, &payload.credential.origin)?;
    let secret = if payload.credential.auth.scheme == "none" {
        None
    } else {
        crate::keychain::keychain_get(payload.credential.provider_id.clone()).await?
    };
    let auth = auth_headers(&payload.credential, secret.as_deref())?;

    // reqwest follows redirects by default; a redirect would replay the key to the redirect target.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let method = reqwest::Method::from_bytes(payload.method.as_bytes()).map_err(|_| "AI: invalid method".to_string())?;
    let mut builder = client.request(method, url);
    for (name, value) in payload.headers.iter() {
        let lowered = name.to_lowercase();
        // The renderer must not be able to set its own auth headers; native owns those.
        if matches!(lowered.as_str(), "authorization" | "proxy-authorization" | "x-api-key" | "api-key") {
            continue;
        }
        builder = builder.header(name, value);
    }
    for (name, value) in auth {
        builder = builder.header(name, value);
    }
    if let Some(body) = payload.body {
        builder = builder.body(body);
    }

    let response = tokio::time::timeout(Duration::from_millis(payload.timeout_ms), builder.send())
        .await
        .map_err(|_| "AI: provider request timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|value| (k.as_str().to_string(), value.to_string())))
        .collect::<HashMap<String, String>>();
    let stream_id = state.next_id();

    let sid = stream_id.clone();
    let handle = async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();
        loop {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    let _ = channel.send(InvokeResponseBody::Raw(chunk.to_vec()));
                }
                Some(Err(err)) => {
                    let _ = channel.send(StreamEvent::error(&sid, err.to_string()));
                    return;
                }
                None => {
                    let _ = channel.send(StreamEvent::end(&sid));
                    return;
                }
            }
        }
    });
    state.register(stream_id.clone(), handle);
    Ok(ProviderResponseHandle { stream_id, status, status_text, headers })
}

/// Teardown from the TS side's abort or stream cancel.
#[tauri::command]
pub fn provider_transport_destroy(stream_id: String, state: State<'_, ProviderTransportState>) {
    state.remove_and_abort(&stream_id);
}
```

- [ ] **Step 2: Register the commands and state in `src-tauri/src/lib.rs`**

Add to the `.manage(...)` block near line 94:

```rust
        // Live-stream registry for the native AI provider transport (abort/teardown by streamId).
        .manage(provider_transport::ProviderTransportState::default())
```

Add to `tauri::generate_handler![...]`, immediately after the `proxy::` entries:

```rust
            provider_transport::provider_transport_request,
            provider_transport::provider_transport_destroy,
```

- [ ] **Step 3: Verify it compiles and existing tests still pass**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: exit 0, no errors.

Run: `cargo test --manifest-path src-tauri/Cargo.toml provider_transport`
Expected: PASS, 7 tests (unchanged from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/provider_transport.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): stream the AI provider response from Rust"
```

---

### Task 3: TypeScript Tauri provider transport

**Files:**
- Create: `src/packages/platform/src/tauri/providerTransport.ts`
- Test: `src/packages/platform/src/tauri/providerTransport.test.ts`

**Interfaces:**
- Consumes: the Rust commands from Task 2; `ProviderTransport`, `ProviderTransportRequest`, `ProviderTransportResponse` from `@/ai-system/core/types`; `TauriInvoke` from `./capabilities/invoke`.
- Produces: `createTauriProviderTransport(deps: TauriProviderTransportDeps): ProviderTransport`, where `TauriProviderTransportDeps = { invoke: TauriInvoke; newChannel: () => ProviderTransportChannel }`.

- [ ] **Step 1: Write the failing test**

Create `src/packages/platform/src/tauri/providerTransport.test.ts`:

```ts
import type { ProviderTransportRequest } from "@/ai-system/core/types";
import { describe, expect, it, vi } from "vitest";
import { createTauriProviderTransport } from "./providerTransport";

function request(overrides: Partial<ProviderTransportRequest> = {}): ProviderTransportRequest {
  return {
    credential: {
      providerId: "openai",
      providerKind: "openai",
      origin: "https://api.openai.com",
      auth: { scheme: "bearer" },
    },
    url: "https://api.openai.com/v1/chat",
    method: "POST",
    headers: { "content-type": "application/json" },
    timeoutMs: 300000,
    maxResponseBytes: 8 * 1024 * 1024,
    ...overrides,
  };
}

function fakeChannel() {
  return { onmessage: null as ((message: unknown) => void) | null };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return out;
    out += new TextDecoder().decode(chunk.value);
  }
}

describe("createTauriProviderTransport", () => {
  it("never sends a secret to the native side and streams raw bytes back", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "provider_transport_request") return undefined;
      // The payload must carry a credential reference only.
      expect(JSON.stringify(args)).not.toContain("sk-");
      queueMicrotask(() => {
        channel.onmessage?.(new TextEncoder().encode("hel").buffer);
        channel.onmessage?.(new TextEncoder().encode("lo").buffer);
        channel.onmessage?.({ streamId: "ai-1", type: "end" });
      });
      return { streamId: "ai-1", status: 200, statusText: "OK", headers: { "content-type": "text/event-stream" } };
    });

    const transport = createTauriProviderTransport({ invoke: invoke as never, newChannel: () => channel });
    const response = await transport.request(request(), new AbortController().signal);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(await readAll(response.body as ReadableStream<Uint8Array>)).toBe("hello");
  });

  it("tears the native stream down when the caller aborts", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (command: string) =>
      command === "provider_transport_request"
        ? { streamId: "ai-7", status: 200, statusText: "OK", headers: {} }
        : undefined,
    );
    const controller = new AbortController();
    const transport = createTauriProviderTransport({ invoke: invoke as never, newChannel: () => channel });
    await transport.request(request(), controller.signal);

    controller.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(invoke).toHaveBeenCalledWith("provider_transport_destroy", { streamId: "ai-7" });
  });

  it("fails the stream when the response exceeds maxResponseBytes", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (command: string) => {
      if (command !== "provider_transport_request") return undefined;
      queueMicrotask(() => channel.onmessage?.(new Uint8Array(64).buffer));
      return { streamId: "ai-2", status: 200, statusText: "OK", headers: {} };
    });
    const transport = createTauriProviderTransport({ invoke: invoke as never, newChannel: () => channel });
    const response = await transport.request(request({ maxResponseBytes: 16 }), new AbortController().signal);
    await expect(readAll(response.body as ReadableStream<Uint8Array>)).rejects.toThrow(/too large/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/packages/platform/src/tauri/providerTransport.test.ts`
Expected: FAIL — cannot resolve `./providerTransport`.

- [ ] **Step 3: Implement the transport**

Create `src/packages/platform/src/tauri/providerTransport.ts`:

```ts
import type { ProviderTransport, ProviderTransportResponse } from "@/ai-system/core/types";

import type { TauriInvoke } from "./capabilities/invoke";

// A Tauri Channel reduced to what this module uses. Body chunks arrive as raw ArrayBuffer frames
// (InvokeResponseBody::Raw); control events arrive as JSON objects.
export interface ProviderTransportChannel {
  onmessage: ((message: unknown) => void) | null;
}

export interface TauriProviderTransportDeps {
  invoke: TauriInvoke;
  newChannel: () => ProviderTransportChannel;
}

interface ProviderResponseHandle {
  streamId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

function asBytes(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  return null;
}

// Provider transport for the Tauri webview. The request names a provider id; Rust resolves the key, attaches the
// auth headers and pins the origin, so the secret never enters this realm. Timeout, the response cap and abort
// stay here so there is one implementation of each rather than one per shell.
export function createTauriProviderTransport(deps: TauriProviderTransportDeps): ProviderTransport {
  const active = new Set<string>();

  return {
    async request(request, signal): Promise<ProviderTransportResponse> {
      const channel = deps.newChannel();
      let streamId: string | undefined;
      let received = 0;
      const queue: Uint8Array[] = [];
      let push: (() => void) | null = null;
      let done = false;
      let failure: Error | null = null;

      const wake = () => {
        push?.();
        push = null;
      };
      const destroy = () => {
        if (!streamId) return;
        active.delete(streamId);
        void deps.invoke("provider_transport_destroy", { streamId }).catch(() => undefined);
      };

      channel.onmessage = (message) => {
        const bytes = asBytes(message);
        if (bytes) {
          received += bytes.byteLength;
          if (received > request.maxResponseBytes) {
            failure = new Error("AI: provider response is too large");
            destroy();
          } else {
            queue.push(bytes);
          }
          wake();
          return;
        }
        const event = message as { type?: string; payload?: { message?: string } };
        if (event?.type === "end") done = true;
        else if (event?.type === "error") failure = new Error(event.payload?.message ?? "AI: provider stream error");
        wake();
      };

      const onAbort = () => {
        failure = failure ?? new Error("AI: provider request aborted");
        destroy();
        wake();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const timeout = setTimeout(() => {
        failure = new Error("AI: provider request timed out");
        destroy();
        wake();
      }, request.timeoutMs);
      timeout.unref?.();

      const handle = await deps.invoke<ProviderResponseHandle>("provider_transport_request", {
        payload: {
          credential: request.credential,
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.body ? Array.from(request.body) : undefined,
          timeoutMs: request.timeoutMs,
        },
        channel,
      });
      streamId = handle.streamId;
      active.add(streamId);
      if (signal.aborted) onAbort();

      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          for (;;) {
            if (queue.length > 0) {
              controller.enqueue(queue.shift() as Uint8Array);
              return;
            }
            if (failure) {
              cleanup();
              controller.error(failure);
              return;
            }
            if (done) {
              cleanup();
              controller.close();
              return;
            }
            await new Promise<void>((resolve) => {
              push = resolve;
            });
          }
        },
        cancel() {
          destroy();
          cleanup();
        },
      });

      return { status: handle.status, statusText: handle.statusText, headers: handle.headers, body };
    },
    dispose() {
      for (const streamId of active) {
        void deps.invoke("provider_transport_destroy", { streamId }).catch(() => undefined);
      }
      active.clear();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run src/packages/platform/src/tauri/providerTransport.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/packages/platform/src/tauri/providerTransport.ts src/packages/platform/src/tauri/providerTransport.test.ts
git commit -m "feat(tauri): add a provider transport that keeps the key out of the webview"
```

---

### Task 4: Wire it in and close the plaintext read

One construction site feeds all four hosts (chat, model discovery, generation, goal), so this swap moves every consumer at once.

**Files:**
- Modify: `src/packages/platform/src/webviewAISystem.ts:64-68`
- Modify: `src/packages/platform/src/tauri/bridge.ts` (add a channel factory beside `newProxyChannel`)
- Modify: `src/packages/platform/src/tauri/capabilities/keychain.ts` (`getKey` must stop returning the secret)
- Modify: `src-tauri/src/lib.rs` (remove `keychain::keychain_get` from `generate_handler!`)
- Modify: `src-tauri/src/keychain.rs` (drop the `#[tauri::command]` attribute from `keychain_get`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createTauriProviderTransport` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Confirm nothing else reads the plaintext key in shared code**

Run: `/usr/bin/grep -rn "getKey" src/ | /usr/bin/grep -v "userConfiguration" | /usr/bin/grep -v "\.test\."`

Expected: hits only in `fetchProviderTransport.ts`, the `IKeychain` port declaration, and the Electron/Tauri/Wails
keychain capabilities. `userConfiguration.getKey` is an unrelated settings reader and is excluded above. If any
other consumer appears, STOP and report it — the plan assumes there is none.

- [ ] **Step 2: Inject the native transport for Tauri, split per request**

The split is per request on the auth scheme, not per shell: a keyless provider never touches the keychain, so it
keeps the in-webview fetch, while anything with a real scheme goes native. `requiresKey` derives from the scheme
(`providers.ts:133`), so a hardened local provider that does require a key correctly goes native too.

In `src/packages/platform/src/webviewAISystem.ts`, replace the `providerTransport:` property at lines 64-68:

```ts
      providerTransport: deps.nativeProviderTransport
        ? routeByAuthScheme(deps.nativeProviderTransport, webviewTransport)
        : webviewTransport,
```

Above the factory in the same file, add the local transport and the router:

```ts
// Keyless providers (local servers with auth.scheme "none") never read the keychain, so they stay on the
// in-webview fetch. Everything with a real scheme goes native, where the secret lives.
function routeByAuthScheme(native: ProviderTransport, webview: ProviderTransport): ProviderTransport {
  return {
    request: (request, signal) =>
      request.credential.auth.scheme === "none"
        ? webview.request(request, signal)
        : native.request(request, signal),
    dispose() {
      native.dispose();
      webview.dispose();
    },
  };
}
```

and build `webviewTransport` from the existing call, keeping `anthropicDirectBrowserAccess` for it because that
path really is a browser realm:

```ts
  const webviewTransport = createFetchProviderTransport({
    keychain: deps.keychain,
    fetchImpl: globalThis.fetch,
    anthropicDirectBrowserAccess: true,
  });
```

Add `nativeProviderTransport?: ProviderTransport;` to the deps interface in the same file, importing
`ProviderTransport` from `@/ai-system/core/types`.

The native path deliberately does NOT send `anthropic-dangerous-direct-browser-access` — Task 2 never adds it,
because a Rust client is not a browser realm.

- [ ] **Step 3: Supply the channel factory and the transport from the Tauri bridge**

First locate where the Tauri shell assembles its AI system, since that is the only place with both `invoke` and
the `Channel` constructor in scope:

Run: `/usr/bin/grep -rn "createWebviewAISystem\|webviewAISystem" src/packages/platform/src/tauri/ src/packages/platform/src/*.ts`

In `src/packages/platform/src/tauri/bridge.ts`, beside the existing `newProxyChannel` factory (around line 99),
add a channel factory for the transport:

```ts
      newProviderTransportChannel: () => new Channel<unknown>(),
```

Then at the assembly site found by the grep above, build the transport and pass it through:

```ts
    nativeProviderTransport: createTauriProviderTransport({
      invoke,
      newChannel: bridge.newProviderTransportChannel,
    }),
```

If the grep shows the AI system is assembled somewhere that lacks `bridge` in scope, thread the factory in the
same way `newProxyChannel` already reaches its consumer — do not construct a second `Channel` import path.

- [ ] **Step 4: Make the Tauri keychain refuse to return the secret**

In `src/packages/platform/src/tauri/capabilities/keychain.ts`, replace the `getKey` implementation:

```ts
    async getKey() {
      // The provider key is resolved in Rust by the native transport and is never handed to this realm.
      throw new Error("AI: reading the provider key is not available in the webview realm");
    },
```

In `src-tauri/src/lib.rs`, delete the `keychain::keychain_get,` line from `generate_handler!`. In
`src-tauri/src/keychain.rs`, remove the `#[tauri::command]` attribute from `keychain_get` and change its
visibility to `pub(crate)` so the transport can still call it internally.

- [ ] **Step 5: Add the CHANGELOG entry**

Under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`, as the first bullet:

```markdown
- The AI provider key is now used only inside the app's native layer on the Tauri build, so it is never handed to the web view
```

- [ ] **Step 6: Verify**

Run each and confirm real output:

```bash
yarn check-types
yarn lint:check
yarn test:run
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: typecheck clean; lint reports **4 warnings** and no errors (those 4 are pre-existing — do not fix them);
tests all pass; `cargo check` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/packages/platform/src/webviewAISystem.ts src/packages/platform/src/tauri/bridge.ts \
  src/packages/platform/src/tauri/capabilities/keychain.ts src-tauri/src/lib.rs src-tauri/src/keychain.rs CHANGELOG.md
git commit -m "feat(tauri): resolve the AI provider key natively and stop exposing it to the web view"
```

---

### Task 5: Live verification on the Tauri build

Static checks never exercise a real provider stream. Tauri has no CDP, so this goes through WebDriver.

**Files:**
- Modify: `support/e2e/ai/flows.mjs` (extend the existing assistant flow assertion)

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: no new exports.

- [ ] **Step 1: Build and launch the Tauri shell with mocks**

Run: `CONTAINER_DESKTOP_MOCK=1 yarn tauri:serve`

This is long-running — start it in the background and do not block on it.

- [ ] **Step 2: Drive the assistant flow**

Run: `yarn test:e2e:tauri`

Expected: the assistant flow passes, meaning a full chat turn streamed through the native transport.

If it fails on a missing `tauri-driver` or `WebKitWebDriver`, those are prerequisites documented in `CLAUDE.md`;
install them rather than working around the harness.

- [ ] **Step 3: Confirm the key is genuinely unreachable from the webview**

With the app running, evaluate in the webview via the WebDriver session:

```js
window.__TAURI__.core.invoke("keychain_get", { account: "openai" })
```

Expected: the promise REJECTS with an unknown-command error, because the command is no longer registered. A
resolved value — even `null` — means Step 4 of Task 4 was not applied correctly.

- [ ] **Step 4: Commit any harness changes**

```bash
git add support/e2e/ai/flows.mjs
git commit -m "test(e2e): cover the native provider transport on Tauri"
```

---

## Notes for the implementer

- `ProviderTransportRequest` has no zod schema and is absent from `invokeSchemas`. It does not cross the AI broker
  IPC boundary (it goes straight to a Tauri command), so this plan does not add one. If a later change routes it
  through the broker, it needs a schema first.
- Status and headers must survive as data, not as a thrown error: the AI SDK classifies retryable failures by HTTP
  status, and errors crossing the boundary keep only `.message`. Task 2 returns them on the handle for this reason.
- Phase B (Wails) reuses this protocol in Go. Do not start it until Phase A is verified end to end.

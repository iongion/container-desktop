# Native provider transport — design

Date: 2026-07-21
Status: approved, not yet implemented
Scope: Tauri (Phase A), then Wails (Phase B)

## Problem

The AI provider API key materialises in a JavaScript realm on two of the three shells.

Tauri and Wails run the AI system inside the webview, and the keychain capability returns the
plaintext key into that realm (`src/packages/platform/src/tauri/capabilities/keychain.ts:24-27`,
and the Wails equivalent). The single consumer is
`src/packages/platform/src/providerTransport/fetchProviderTransport.ts:61`, which reads the key and
attaches it to the outbound provider request.

Electron does not have this problem. It runs the whole AI system in the main process
(`src/packages/platform/src/electron/main.ts:270`), builds the transport from the main-side
safeStorage keychain (`src/packages/platform/src/electron/aiSystem.ts:101`), and `src/web-app/`
contains no reference to the transport at all. Electron is the reference design, not the thing to
change.

Goal: on every shell, the key never enters a JavaScript realm.

## Non-goals

- Moving Electron's AI host into the renderer for implementation uniformity. That would weaken the
  one correct shell in order to match the two weak ones. Revisit only after Phase B, when all three
  shells share one transport port.
- Changing SSE parsing, or the AI SDK's retry behaviour. Retries live above the transport, inside
  the SDK; the transport itself has none.
- Routing keyless local providers (Ollama, LM Studio, llama.cpp) through native code. They never
  touch the keychain today.

## Design

The renderer sends a request that names a **provider id, never a key**. The native side owns the
secret and the destination.

Per request, native:

1. resolves the key from its own keychain by provider id;
2. applies the auth-scheme to header mapping — the existing four-way switch, including Anthropic's
   `x-api-key` special case (`fetchProviderTransport.ts:63-74`);
3. **validates the destination origin against that provider's registered base URL**;
4. disables redirect following explicitly;
5. issues the HTTPS request and streams the raw response bytes back.

TypeScript keeps everything that is not security-critical: the 5-minute timeout, the 8 MiB response
cap, abort plumbing, and SSE parsing. The response body is opaque bytes today
(`fetchProviderTransport.ts:131-133`), so none of that needs to understand the payload.

This moves roughly 40 lines of security-critical logic into each native shell rather than porting
all ~130 lines of the transport twice.

### Why origin validation is load-bearing

Once the renderer is the untrusted side, it must not be able to name an arbitrary destination for a
request that native will attach a real key to. Without an origin check, a compromised renderer asks
for `https://attacker.example/` with `providerId: "anthropic"` and native helpfully signs it. The
check is what makes "the renderer supplies the URL" safe, and it is the reason this design is not
simply a placeholder-substitution proxy.

### Splitting keyless providers

Keyless providers keep the existing in-webview fetch unchanged. The split keys off
`credential.auth.scheme === "none"` **per request** — not a local/cloud flag. `requiresKey` already
derives from the scheme (`providers.ts:135`), and the code explicitly anticipates a hardened local
provider that does require a key.

### Wire format

Chunks must be framed as bytes. The body is opaque, and the existing text path corrupts any
multi-byte codepoint that straddles a chunk boundary (`from_utf8_lossy`, `src-tauri/src/proxy.rs:309`;
the Wails JSON marshal substitutes U+FFFD at `proxy_service.go:500`). Both shells already have
byte-exact modes — Tauri's `InvokeResponseBody::Raw` and the Wails base64 `binary:true` path. The
gap is only selection: today the binary switch is a hardcoded `contains("/logs")` substring test,
which `/v1/messages` would not match.

The stream envelope reuses the *shape* of the command-proxy protocol, on a new and separate channel
— the broker itself is not reusable (see below). Modelled on
`src/packages/platform/src/commandProxy/commandProxyProtocol.ts:11-15`: invoke returns
`{streamId, status, headers}`, followed by pushes of `{streamId, type: data|end|error, payload}`,
with an explicit destroy for cancellation. Copying the shape keeps the renderer-side reassembler
familiar; copying the broker would inherit its socket binding.

### The existing proxies cannot be reused

Both native proxies are bound to local sockets in the HTTP client itself, not by convention. Tauri
binds `unix_socket(socket_path)` at construction (`src-tauri/src/proxy.rs:186-192`); the Wails dialer
discards the requested address entirely (`src-wails/proxy_service.go:183-187`). Both hard-error when
no socket is configured, so there is no escape hatch to TCP, and their bodies are JSON-typed so raw
bytes cannot be expressed. This needs a new native command. The existing connectivity probe
(`proxy.rs:334-366`) confirms TLS-capable clients are already linked into both binaries.

## Security decisions

- **Redirects must be disabled explicitly.** `redirect: "manual"` is implicit in `fetch`
  (`fetchProviderTransport.ts:114`), but reqwest and Go both follow redirects by default. Porting
  naively replays the key to the redirect target. This is the single most likely way to get this
  wrong.
- **Delete `anthropic-dangerous-direct-browser-access`.** It exists only because the call currently
  originates from a browser realm. Moving native removes the reason for it; it must not be ported.
- **Validate renderer-supplied input.** `ProviderTransportRequest` has no zod schema today and is
  absent from `invokeSchemas`. It becomes untrusted input the moment it crosses the boundary, so it
  needs one.
- **Native needs its own upper bounds.** Timeout and response cap stay in TypeScript so there is one
  implementation rather than three, which means native honours a renderer-supplied deadline. That is
  acceptable only with an independent native ceiling, so a hostile renderer cannot request an
  unbounded request. The TS value is the policy; the native value is the backstop.
- **Error fidelity.** Errors crossing contextBridge retain only `.message`
  (`commandProxyClient.ts:67-81`). The AI SDK classifies retryable failures by HTTP status, so status
  and headers must survive the boundary as data, not as an exception.

## Scope

**Phase A — Tauri.** Move both the chat transport and model discovery
(`modelDiscoveryHost.ts:34`) to the native path, then remove the plaintext key read from the Tauri
capability surface.

Moving chat alone achieves nothing: discovery is a second transport consumer, and it is what the
Settings "Test connection" button exercises. If it keeps using the in-webview path, the plaintext
read has to stay and the objective is not met.

Removing the read is safe otherwise. There is no `keyGet` IPC channel — the broker exposes only
`keyHas` / `setKey` / `clearKey` (`broker.ts:179-188`). Settings renders a masked field from
`hasKey` and never reads the secret back (`AIProviderConfig.tsx:172-173`); "Test connection" calls
`listModels` (`:208`).

Note when grepping: `getKey` is overloaded. `userConfiguration.getKey` is an unrelated settings
reader with roughly twenty call sites and is not in scope.

**Phase B — Wails.** Same protocol, same split, ported to Go.

## Testing

Per project convention: unit tests for logic, no component tests, live verification in the running
app.

- Auth-scheme to header mapping, including the Anthropic `x-api-key` case.
- Origin validation: a request whose destination does not match the provider's registered base URL
  is rejected **before** any key is attached.
- `auth.scheme === "none"` bypasses the native path entirely.
- Redirect responses are surfaced, not followed.
- Byte-exactness: a multi-byte codepoint split across a chunk boundary survives the round trip.

Tauri has no CDP, so live verification goes through WebDriver (`yarn test:e2e:tauri`), not
`support/cdp.mjs`.

## Risks

- The auth matrix and origin check are duplicated in Rust and Go, and can drift. Mitigated by
  keeping the duplicated surface small (~40 lines) and testing both against the same cases.
- Streaming byte-exactness is easy to regress, because the corruption only appears when a multi-byte
  codepoint straddles a chunk boundary — rare, and invisible in short test payloads.
- Status/header fidelity across the boundary directly affects the SDK's retry behaviour. Losing it
  degrades 429 handling silently.

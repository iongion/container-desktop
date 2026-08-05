// The environment contract between the app and the pi agent / gateway container pair. Pure, so the two
// producers of the gateway env file — the host broker, which reads the key from the OS keychain, and the
// renderer's explicit-key path — compose byte-identical files instead of drifting apart.

import type { ProviderKind } from "@/ai-system/core/providers";
import type { AIAuthSettings } from "@/ai-system/core/types";

// The wire shape pi speaks to the gateway. It has to be the UPSTREAM's shape: the gateway proxies bytes, so a
// request that leaves pi as OpenAI completions can never satisfy Anthropic's /v1/messages endpoint.
export type UpstreamModelApi = "openai-completions" | "anthropic-messages";

export function upstreamModelApi(kind: ProviderKind): UpstreamModelApi {
  return kind === "anthropic" ? "anthropic-messages" : "openai-completions";
}

// Each client shape expects a different base URL. pi's openai-completions client posts `/chat/completions`
// onto a base that already carries the version segment; its anthropic-messages client is the Anthropic SDK,
// which posts `/v1/messages` onto the origin. Handing both the shape they expect makes each request arrive at
// the gateway as `/v1/…` — exactly the one prefix buildUpstreamRequest strips before joining the upstream base.
export function gatewayBaseUrl(origin: string, api: UpstreamModelApi): string {
  return api === "anthropic-messages" ? origin : `${origin}/v1`;
}

// What the host substitutes with the real credential. The renderer composes the gateway's env file with this
// in place of the key, so the plaintext exists only in the realm that owns the vault. Mirrored verbatim in
// each shell's native keychain (SECRET_PLACEHOLDER), the same way the auth-scheme vocabulary is mirrored.
export const KEYCHAIN_SECRET_PLACEHOLDER = "__CD_KEYCHAIN_SECRET__";

export interface GatewayEnvironment {
  baseUrl: string;
  apiKey: string;
  bridgeToken: string;
  gatewayPort: number;
  // The upstream's kind and connection auth, mirroring what the app's own provider transport derives. Without
  // them the gateway can only sign a bearer token, which Anthropic rejects.
  providerKind: ProviderKind;
  auth: AIAuthSettings;
}

function envValue(name: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`AI: ${name} cannot contain a newline`);
  }
  return `${name}=${value}`;
}

export function composeGatewayEnv(environment: GatewayEnvironment): string {
  const { auth } = environment;
  return [
    envValue("CD_UPSTREAM_BASE_URL", environment.baseUrl),
    envValue("CD_UPSTREAM_API_KEY", environment.apiKey),
    envValue("CD_UPSTREAM_KIND", environment.providerKind),
    envValue("CD_UPSTREAM_AUTH_SCHEME", auth.scheme),
    ...(auth.headerName ? [envValue("CD_UPSTREAM_AUTH_HEADER_NAME", auth.headerName)] : []),
    ...(auth.username ? [envValue("CD_UPSTREAM_AUTH_USERNAME", auth.username)] : []),
    envValue("CD_BRIDGE_TOKEN", environment.bridgeToken),
    envValue("CD_GATEWAY_PORT", String(environment.gatewayPort)),
  ].join("\n");
}

// The one-shot auth container's env file for a REFRESH run: the bridge it listens on, plus the credential it is to
// exchange. Composed here beside the gateway's for the same reason — one producer, so the placeholder the vault's
// realm substitutes cannot drift from the name the container reads.
export interface AuthRefreshEnvironment {
  bridgeToken: string;
  bridgePort: number;
  credential: string;
}

export function composeAuthRefreshEnv(environment: AuthRefreshEnvironment): string {
  return [
    envValue("CD_BRIDGE_TOKEN", environment.bridgeToken),
    envValue("CD_BRIDGE_PORT", String(environment.bridgePort)),
    envValue("CD_CREDENTIAL", environment.credential),
  ].join("\n");
}

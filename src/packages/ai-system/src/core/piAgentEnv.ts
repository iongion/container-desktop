// The environment contract between the app and the containers it runs. Pure, so a value the container reads back cannot
// drift from the one the app meant.

import type { ProviderKind } from "@/ai-system/core/providers";
import type { UpstreamModelApi } from "@/pi-bridge/providerEndpoint";

// The wire shape pi speaks. It has to be the UPSTREAM's, because the app forwards bytes: a request that leaves pi as
// OpenAI completions can never satisfy Anthropic's /v1/messages endpoint.
export function upstreamModelApi(kind: ProviderKind): UpstreamModelApi {
  return kind === "anthropic" ? "anthropic-messages" : "openai-completions";
}

// What the host substitutes with the real credential. A caller composes a file with this in place of the secret, so the
// plaintext exists only in the realm that owns the vault. Mirrored verbatim in each shell's native keychain
// (SECRET_PLACEHOLDER). One file still needs it — the auth container's, below — because pi's own flow code is what
// exchanges a refresh token, and it has to be handed the credential to exchange.
export const KEYCHAIN_SECRET_PLACEHOLDER = "__CD_KEYCHAIN_SECRET__";

function envValue(name: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`AI: ${name} cannot contain a newline`);
  }
  return `${name}=${value}`;
}

// The one-shot auth container's env file for a REFRESH run: the bridge it listens on, plus the credential it is to
// exchange. Composed here, in one place, so the placeholder the vault's realm substitutes cannot drift from the name
// the container reads.
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

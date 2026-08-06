// Where pi's own provider layer posts inference, and the wire shape it speaks there.
//
// Both ends need these and neither may own them: the container binds the port and composes the base URL it registers
// with pi, and the app derives the shape from the provider's catalogue kind. The same reason `SESSIONS_DIR_IN_IMAGE`
// lives beside the image identity rather than in either half.

// The wire shape the UPSTREAM speaks. It has to be the upstream's own: the app forwards bytes, so a request that
// leaves pi as OpenAI completions can never satisfy Anthropic's /v1/messages endpoint.
export type UpstreamModelApi = "openai-completions" | "anthropic-messages";

const UPSTREAM_MODEL_APIS: readonly UpstreamModelApi[] = ["openai-completions", "anthropic-messages"];

// Absent ⇒ OpenAI completions, which is what every other provider family speaks.
export function parseUpstreamModelApi(value: string | undefined): UpstreamModelApi {
  if (!value) return "openai-completions";
  if (!UPSTREAM_MODEL_APIS.includes(value as UpstreamModelApi)) {
    throw new Error(`CD_MODEL_API must be one of ${UPSTREAM_MODEL_APIS.join(", ")}`);
  }
  return value as UpstreamModelApi;
}

// The port the agent container's provider proxy listens on, on the container's OWN loopback. Fixed rather than picked:
// it is never published, so nothing outside that container can reach it and there is nothing on the host to collide
// with. A published port would be a second way in for something that must only ever be reached from inside.
//
// It must not be one the container ALREADY binds — 8787 is the bridge and 8789 the conversation store's worker, and
// picking that one made every session with the storage RPC die on EADDRINUSE. Found by the probe, not by reading.
export const PI_PROVIDER_PROXY_PORT = 8790;

// The base URL pi is registered with. Each client shape expects a different one: pi's openai-completions client posts
// `/chat/completions` onto a base that already carries the version segment, while its anthropic-messages client is the
// Anthropic SDK, which posts `/v1/messages` onto the origin. Handing each the shape it expects makes every request
// arrive at the proxy as `/v1/…`, which is the one prefix the app strips before joining the upstream's base.
export function providerProxyBaseUrl(api: UpstreamModelApi): string {
  const origin = `http://127.0.0.1:${PI_PROVIDER_PROXY_PORT}`;
  return api === "anthropic-messages" ? origin : `${origin}/v1`;
}

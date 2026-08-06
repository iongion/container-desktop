// What the app will forward for the agent container's provider proxy, and what it refuses.
//
// The container asks for a PATH; the app decides what that resolves to. It has to be this way round for the same reason
// the conversation store's confinement is app-side (`sessionStorageOps`): the agent container runs plugin code, and a
// check made in there is a check that code could edit out. Structural, never by normalizing a traversal into something
// plausible — a path that lands back inside is still refused.
//
// The upstream is the provider the USER configured, resolved from settings by the broker. Nothing here can point a
// request at another one.

export type ProviderProxyVerdict = { ok: true; url: string } | { ok: false; reason: string };

// The verbs inference uses: a completion is a POST, a model list a GET. pi asks for nothing else, so nothing else is
// forwarded — the blast radius of a proxy is the set of requests it will make on someone's behalf.
const FORWARDED_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST"]);

function refused(reason: string): ProviderProxyVerdict {
  return { ok: false, reason };
}

// The upstream's own base, as an endpoint this may sign a request for. A URL carrying credentials or a non-HTTP scheme
// is refused rather than repaired: it would mean the provider's configured endpoint is not one at all.
function upstreamBase(upstreamBaseUrl: string): URL | undefined {
  let base: URL;
  try {
    base = new URL(upstreamBaseUrl);
  } catch {
    return undefined;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return undefined;
  if (base.username || base.password) return undefined;
  // A trailing slash is what makes `new URL(relative, base)` keep the last segment instead of replacing it, so the
  // base path is normalized to end in one exactly once.
  base.pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return base;
}

export function resolveProviderProxyRequest(
  request: { method: string; path: string },
  upstreamBaseUrl: string,
): ProviderProxyVerdict {
  if (!FORWARDED_METHODS.has(request.method.toUpperCase())) {
    return refused(`inference does not use the ${request.method} method`);
  }
  const base = upstreamBase(upstreamBaseUrl);
  if (!base) return refused("the provider's endpoint is not a usable HTTP endpoint");
  // A path, and only a path. `//host` and `https://host` both parse as somewhere else entirely, and a bare
  // `chat/completions` would resolve against whatever the base happened to end in.
  if (!request.path.startsWith("/") || request.path.startsWith("//")) {
    return refused("a provider request must name a path on the configured endpoint");
  }
  // The one `/v1` the proxy's OWN base contributed, so the upstream's base supplies its own. Exactly one, so a model
  // actually called `v1` still resolves.
  const suffix = request.path.replace(/^\/v1(?=\/|$)/, "");
  let resolved: URL;
  try {
    resolved = new URL(suffix.replace(/^\/+/, ""), base);
  } catch {
    return refused("a provider request must name a path on the configured endpoint");
  }
  // Origin AND base path. The origin alone would let a traversal reach another tenant on the same aggregator host,
  // which is a different API with the user's key on it.
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    return refused("a provider request cannot reach outside the configured endpoint");
  }
  return { ok: true, url: resolved.toString() };
}

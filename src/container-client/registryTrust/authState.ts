// Pure reader for "is this engine already signed in to registry X?" — parses a docker/podman auth file
// (config.json / auth.json share the `auths`/`credHelpers`/`credsStore` shape) and answers per registry. Used to
// gate the Security tab's "log in to verify" recovery: only offer sign-in when the engine has NO credential for
// the registry (offering it again when already signed in is pointless — the failure is access, not auth). Pure +
// node-free; the file READ (native FS vs scoped `cat`) stays in Application.

export interface RegistryLoginState {
  loggedIn: boolean;
  // Best-effort account label (from an inline `auth` blob or `username`); undefined for helper-stored creds.
  account?: string;
}

// Docker Hub is addressed under several aliases; its docker config.json key is the legacy v1 URL.
const DOCKER_HUB_HOSTS = ["docker.io", "index.docker.io", "registry-1.docker.io", "registry.hub.docker.com"];
const DOCKER_HUB_KEY = "https://index.docker.io/v1/";

function bareHost(registry: string): string {
  return registry
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function isDockerHub(registry: string): boolean {
  const host = bareHost(registry);
  return host === "" || DOCKER_HUB_HOSTS.includes(host);
}

// The auth-file keys a given registry may be stored under: docker keeps `https://host` (Hub → the v1 URL),
// podman keeps the bare host. Try every plausible form so a match is not missed across engines/versions.
function candidateKeys(registry: string): string[] {
  if (isDockerHub(registry)) {
    return [DOCKER_HUB_KEY, "index.docker.io", "docker.io", "registry-1.docker.io"];
  }
  const host = bareHost(registry);
  return [host, `https://${host}`, `${host}/`, `https://${host}/`];
}

// Decode the account from an entry: explicit `username`, else the user part of the base64 `auth` (user:secret).
function accountFromEntry(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const record = entry as { username?: string; auth?: string };
  if (record.username) {
    return record.username;
  }
  if (record.auth) {
    try {
      const decoded = atob(record.auth);
      const user = decoded.slice(0, decoded.indexOf(":"));
      return user || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Is the engine signed in to `registry`, per its auth file text? A present `auths[key]` (even with an empty blob —
// credsStore-backed logins still write the key) or a `credHelpers[host]` counts as signed in. Unparseable/empty
// text → not signed in (so the recovery CTA is offered rather than wrongly suppressed).
export function isRegistryLoggedIn(configText: string | undefined, registry: string): RegistryLoginState {
  if (!configText?.trim()) {
    return { loggedIn: false };
  }
  let config: { auths?: Record<string, unknown>; credHelpers?: Record<string, unknown> };
  try {
    config = JSON.parse(configText);
  } catch {
    return { loggedIn: false };
  }
  const auths = config?.auths || {};
  const credHelpers = config?.credHelpers || {};
  for (const key of candidateKeys(registry)) {
    if (Object.hasOwn(auths, key)) {
      return { loggedIn: true, account: accountFromEntry(auths[key]) };
    }
    if (Object.hasOwn(credHelpers, key)) {
      return { loggedIn: true };
    }
  }
  return { loggedIn: false };
}

// Deterministic mock (dev/demo only — gated by isMockMode in Application): never signed in, so the mock
// auth-required signature always demonstrates the sign-in recovery flow.
export function mockRegistryLoginState(_registry: string): RegistryLoginState {
  return { loggedIn: false };
}

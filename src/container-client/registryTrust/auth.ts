// Pure argv builders for registry `login` / `logout` (podman + docker share this surface). The SECRET is NEVER
// an argv element — `--password-stdin` makes the engine read the token from stdin, which the exec layer pipes in
// via HostExecOptions.input. This keeps credentials out of `ps`, argv logs, and shell history.

export interface RegistryLoginArgsOptions {
  // When explicitly false, append `--tls-verify=false` (podman only — docker configures insecure registries in
  // daemon.json, not a login flag, so the engine-aware caller passes this for podman insecure endpoints only).
  tlsVerify?: boolean;
}

export function buildLoginArgs(registry: string, username: string, opts?: RegistryLoginArgsOptions): string[] {
  const args = ["login", registry, "--username", username, "--password-stdin"];
  if (opts?.tlsVerify === false) {
    args.push("--tls-verify=false");
  }
  return args;
}

export function buildLogoutArgs(registry: string): string[] {
  return ["logout", registry];
}

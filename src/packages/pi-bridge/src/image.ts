// The agent image identity. Shared rather than CLI-local: the build command and the renderer store
// must agree on the tag, and the renderer must not import from support/cli.
export const AGENT_IMAGE_REPOSITORY = "container-desktop/pi-agent";

export function agentImageTag(version: string): string {
  return `${AGENT_IMAGE_REPOSITORY}:${version}`;
}

// Where the user's conversations appear INSIDE the container — outside the agent dir, or they would be back inside
// the plugin volume. Both ends need it and neither may own it: the app either bind-mounts its own directory here or
// serves this path over the storage RPC, and the container is pointed at it with `CD_SESSION_DIR` either way. The
// paths crossing that RPC are all under this root, which is what makes confining them a structural check rather
// than a comparison against a host path the container was never told.
export const SESSIONS_DIR_IN_IMAGE = "/home/agent/.cd/sessions";

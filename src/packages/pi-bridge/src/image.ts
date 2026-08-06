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

// The bridge the container listens on. Declared here beside the image's other facts because BOTH ends need it and
// neither may own it: the app publishes it, the container binds it, and it was written out three times before — which is
// how the provider proxy came to be given a port the conversation store already had.
export const PI_BRIDGE_PORT_IN_IMAGE = 8787;

// Where the agent's own environment appears when it could not be handed to the engine as a file. `--env-file` is read
// by the engine's CLIENT, so a path under this app's user data means nothing to a podman on another machine: the same
// contents are written into a session volume mounted here instead, and named in `CD_ENV_FILE`.
export const AGENT_ENV_DIR_IN_IMAGE = "/cd-env";
export const AGENT_ENV_FILE_IN_IMAGE = `${AGENT_ENV_DIR_IN_IMAGE}/agent.env`;

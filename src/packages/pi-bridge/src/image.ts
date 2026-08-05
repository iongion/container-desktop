// The agent image identity. Shared rather than CLI-local: the build command and the renderer store
// must agree on the tag, and the renderer must not import from support/cli.
export const AGENT_IMAGE_REPOSITORY = "container-desktop/pi-agent";

export function agentImageTag(version: string): string {
  return `${AGENT_IMAGE_REPOSITORY}:${version}`;
}

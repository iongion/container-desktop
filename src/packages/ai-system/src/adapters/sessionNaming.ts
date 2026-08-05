// What the assistant's engine resources are CALLED and how they are LABELLED — one place, so the two can never
// disagree and every producer states identity the same way.
//
// Two mechanisms, deliberately, because they answer different questions:
//
//   NAMES are for lookup. They are deterministic, so the app can address a container directly (`inspect <name>`)
//   with no listing at all, and prefix-searchable for a human reading `podman ps`. They follow compose's own
//   `<project>-<service>-<scope>` grammar under one project — "container-desktop" — so what belongs together looks
//   like it belongs together.
//
//   LABELS are for identity and tracking. A name is charset-limited, which is the only reason one carries a folded
//   slug; a label holds the connection id verbatim. The compose project/service pair is stamped as well, which is
//   what makes these containers GROUP — in Docker Desktop, in podman, and in this app's own Containers screen, whose
//   grouping already keys off those labels (`computeComposeGroup`). That grouping is display-only: no compose
//   operation is offered on a group discovered by label, so stamping it cannot expose the pair to a `compose down`.

import { LABEL_PROJECT, LABEL_SERVICE } from "@/container-client/compose/labels";

// The group everything this app creates belongs to. Compose project names are lowercase, which this already is.
export const ASSISTANT_PROJECT = "container-desktop";

// `default` is the session a connection REUSES — the one the user is asked about once and that outlives the app.
// `ephemeral` is created for a single run and swept at the next boot.
export type AiSessionKind = "default" | "ephemeral";
export type AiSessionRole = "agent" | "gateway" | "login";

export interface AiSessionIdentity {
  kind: AiSessionKind;
  role: AiSessionRole;
  // The connection whose engine holds these containers. Absent only for a resource that belongs to no connection.
  connectionId?: string;
}

export const AI_SESSION_LABEL = {
  session: "container-desktop.ai.session",
  role: "container-desktop.ai.role",
  connection: "container-desktop.ai.connection",
} as const;

// FNV-1a, hand-rolled because this module is bundled into the renderer, where node:crypto is absent. Only ever used
// to tell apart two connection ids whose name-safe forms collide, so a 32-bit digest is ample.
function shortDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

// An engine accepts `[a-zA-Z0-9][a-zA-Z0-9_.-]*`; a connection id is free text. The digest is appended only when
// folding actually changed something, which keeps the ordinary `podman-1` readable while still giving two ids that
// fold alike two different names. Identity does not depend on this — the label carries the id verbatim.
function nameSafe(value: string): string {
  const folded = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32);
  const base = folded || "connection";
  return folded === value ? base : `${base}-${shortDigest(value)}`;
}

// The scope of the session a resource belongs to: which reusable session, or which single run.
export function defaultScope(connectionId: string): string {
  return `default-${nameSafe(connectionId)}`;
}

export function assistantContainerName(role: AiSessionRole, scope: string): string {
  return `${ASSISTANT_PROJECT}-${role}-${scope}`;
}

export function assistantNetworkName(scope: string): string {
  return `${ASSISTANT_PROJECT}-net-${scope}`;
}

// The second network, which exists only when egress is off: the gateway still has to reach the provider, so it gets a
// routable NIC the agent does not have. That asymmetry IS "only the gateway is reachable".
export function egressNetworkOf(networkName: string): string {
  return `${networkName}-egress`;
}

// Deliberately NOT renamed to match the project. This volume is mounted at pi's agent directory, which holds the
// user's installed plugins AND every stored conversation (`~/.pi/agent/sessions/`). A new name would present an empty
// volume and silently lose all of it — consistency is not worth the user's history.
export const ASSISTANT_PLUGIN_VOLUME = "cd-agent-plugins";

// Both halves of what a session's resources are stamped with: the compose pair that makes them group, and this app's
// own identity, which compose labels cannot express.
export function assistantLabels(identity: AiSessionIdentity): Record<string, string> {
  return {
    [LABEL_PROJECT]: ASSISTANT_PROJECT,
    [LABEL_SERVICE]: identity.role,
    [AI_SESSION_LABEL.session]: identity.kind,
    [AI_SESSION_LABEL.role]: identity.role,
    ...(identity.connectionId ? { [AI_SESSION_LABEL.connection]: identity.connectionId } : {}),
  };
}

export function assistantLabelArgv(identity: AiSessionIdentity): string[] {
  return Object.entries(assistantLabels(identity)).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

// Asking the engine to do the selecting, rather than listing everything and matching by pattern.
export function assistantFilterArgv(selector: { kind: AiSessionKind; connectionId?: string }): string[] {
  return [
    "--filter",
    `label=${AI_SESSION_LABEL.session}=${selector.kind}`,
    ...(selector.connectionId ? ["--filter", `label=${AI_SESSION_LABEL.connection}=${selector.connectionId}`] : []),
  ];
}

// What earlier versions called these resources. Containers created before the labels existed can only be recognised
// by name, and the reaper still has to clear them — so this stays until it is safe to assume nobody is upgrading.
export const LEGACY_ASSISTANT_CONTAINER = /^cd-(agent|gateway|login)-[0-9a-f]{8}$/;
export const LEGACY_ASSISTANT_NETWORK = /^cd-agent-net-[0-9a-f]{8}(-egress)?$/;

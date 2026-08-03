import { WORKER_TOOL_CATALOGUE, type WorkerToolEntry } from "./workerTools";

export type AccessProfileId = "observe" | "workspace" | "operator";

export interface AccessProfile {
  id: AccessProfileId;
  labelKey: string;
  descriptionKey: string;
}

export const ACCESS_PROFILES: readonly AccessProfile[] = [
  {
    id: "observe",
    labelKey: "Observe",
    descriptionKey: "Inspect containers and workspace files without changing them",
  },
  {
    id: "workspace",
    labelKey: "Workspace",
    descriptionKey: "Inspect containers and work in project files",
  },
  {
    id: "operator",
    labelKey: "Operator",
    descriptionKey: "Use every available container and workspace tool",
  },
];

export const DEFAULT_ACCESS_PROFILE: AccessProfileId = "operator";

function included(profile: AccessProfileId, tool: WorkerToolEntry): boolean {
  if (profile === "operator") return true;
  if (profile === "workspace") return tool.group === "workspace" || !tool.gated;
  return !tool.gated;
}

export function accessProfileTools(profile: AccessProfileId): ReadonlySet<string> {
  return new Set(WORKER_TOOL_CATALOGUE.filter((tool) => included(profile, tool)).map(({ name }) => name));
}

export function accessProfile(profile: AccessProfileId): AccessProfile {
  return ACCESS_PROFILES.find(({ id }) => id === profile) ?? ACCESS_PROFILES[0];
}

export function isAccessProfileId(value: string): value is AccessProfileId {
  return ACCESS_PROFILES.some(({ id }) => id === value);
}

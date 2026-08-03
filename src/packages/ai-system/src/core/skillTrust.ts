import { z } from "zod";

export const SKILL_TRUST_VERSION = 1 as const;
const MAX_TRUST_FILE_BYTES = 512 * 1024;
const MAX_TRUSTED_SOURCES = 64;
const MAX_TRUSTED_SKILLS = 1_024;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

const projectSkillSourceTrust = z
  .object({ workspaceId: hash, root: z.string().min(1).max(8_192), enabledAt: z.number().int().nonnegative() })
  .strict();

const projectSkillTrust = z
  .object({
    workspaceId: hash,
    root: z.string().min(1).max(8_192),
    skillId: z.string().min(1).max(256),
    fingerprint: hash,
    trustedAt: z.number().int().nonnegative(),
  })
  .strict();

const skillTrustFile = z
  .object({
    version: z.literal(SKILL_TRUST_VERSION),
    sources: z.array(projectSkillSourceTrust).max(MAX_TRUSTED_SOURCES),
    skills: z.array(projectSkillTrust).max(MAX_TRUSTED_SKILLS),
  })
  .strict();

export type ProjectSkillSourceTrust = z.infer<typeof projectSkillSourceTrust>;
export type ProjectSkillTrust = z.infer<typeof projectSkillTrust>;

export interface SkillTrustSnapshot {
  status: "missing" | "ok" | "error";
  path: string;
  sources: ProjectSkillSourceTrust[];
  skills: ProjectSkillTrust[];
}

export interface SkillTrustStore {
  load(): Promise<SkillTrustSnapshot>;
  save(snapshot: SkillTrustSnapshot): Promise<void>;
}

export function parseSkillTrustFile(text: string): Omit<SkillTrustSnapshot, "path"> {
  if (new TextEncoder().encode(text).byteLength > MAX_TRUST_FILE_BYTES) {
    return { status: "error", sources: [], skills: [] };
  }
  try {
    const result = skillTrustFile.safeParse(JSON.parse(text));
    return result.success
      ? { status: "ok", sources: result.data.sources, skills: result.data.skills }
      : { status: "error", sources: [], skills: [] };
  } catch {
    return { status: "error", sources: [], skills: [] };
  }
}

export function prepareSkillTrustFile(snapshot: SkillTrustSnapshot): z.infer<typeof skillTrustFile> {
  const file = {
    version: SKILL_TRUST_VERSION,
    sources: snapshot.sources.slice(0, MAX_TRUSTED_SOURCES),
    skills: snapshot.skills.slice(0, MAX_TRUSTED_SKILLS),
  };
  const result = skillTrustFile.safeParse(file);
  if (!result.success || new TextEncoder().encode(JSON.stringify(file)).byteLength > MAX_TRUST_FILE_BYTES) {
    throw new Error("AI: invalid or oversized skill trust record");
  }
  return result.data;
}

export function isProjectSkillTrusted(
  snapshot: SkillTrustSnapshot,
  identity: Omit<ProjectSkillTrust, "trustedAt">,
): boolean {
  if (snapshot.status !== "ok") return false;
  const sourceEnabled = snapshot.sources.some(
    (source) => source.workspaceId === identity.workspaceId && source.root === identity.root,
  );
  return (
    sourceEnabled &&
    snapshot.skills.some(
      (skill) =>
        skill.workspaceId === identity.workspaceId &&
        skill.root === identity.root &&
        skill.skillId === identity.skillId &&
        skill.fingerprint === identity.fingerprint,
    )
  );
}

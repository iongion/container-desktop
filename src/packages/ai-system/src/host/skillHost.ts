import { sha256Text } from "@/ai-system/adapters/sha256";
import { discoverSkillSource, readSkillRecord } from "@/ai-system/adapters/skillDiscovery";
import {
  type ResolvedSkillInvocation,
  type ResolveSkillInvocationRequest,
  SKILL_LIMITS,
  type SkillDescriptor,
  type SkillDiagnostic,
  type SkillHostSnapshot,
  type SkillRecord,
  type SkillSourceSnapshot,
  type SkillViewDescriptor,
} from "@/ai-system/core/skills";
import type { SkillTrustSnapshot, SkillTrustStore } from "@/ai-system/core/skillTrust";
import { isProjectSkillTrusted } from "@/ai-system/core/skillTrust";
import type { IFileDiscoverySystem, IPath } from "@/host-contract/fs";

interface ProjectContext {
  workspaceId: string;
  root: string;
  canonicalRoot: string;
}

export interface SkillHostDeps {
  userRoot: string;
  getWorkspaceRoot: () => Promise<string | undefined> | string | undefined;
  trustStore: SkillTrustStore;
  fs: IFileDiscoverySystem;
  path: IPath;
  watch?: boolean;
  watchIntervalMs?: number;
  watchDebounceMs?: number;
  logger?: { error: (...args: unknown[]) => void };
}

export interface SkillHost {
  ready(): Promise<void>;
  startWatching(): Promise<void>;
  snapshot(): SkillHostSnapshot;
  reload(): Promise<SkillHostSnapshot>;
  setProjectSourceEnabled(enabled: boolean): Promise<SkillHostSnapshot>;
  setProjectSkillTrust(skillId: string, expectedFingerprint: string, trusted: boolean): Promise<SkillHostSnapshot>;
  resolveInvocation(request: ResolveSkillInvocationRequest): Promise<ResolvedSkillInvocation>;
  subscribe(listener: (snapshot: SkillHostSnapshot) => void): () => void;
  dispose(): void;
}

const WATCH_INTERVAL_MS = 2_000;
const WATCH_DEBOUNCE_MS = 250;

function emptySnapshot(userRoot: string): SkillHostSnapshot {
  return { revision: "0", user: { root: userRoot, status: "error" }, skills: [], diagnostics: [] };
}

function isTransient(diagnostic: SkillDiagnostic): boolean {
  return diagnostic.code === "source-unreadable" || diagnostic.code === "file-changing";
}

function withLastKnownGood(previous: SkillSourceSnapshot | undefined, next: SkillSourceSnapshot): SkillSourceSnapshot {
  if (!previous) return next;
  if (next.status === "error") {
    return { ...next, skills: previous.skills, records: previous.records, totalBytes: previous.totalBytes };
  }
  const retained = previous.records.filter(
    (record) =>
      !next.records.some((candidate) => candidate.descriptor.id === record.descriptor.id) &&
      next.diagnostics.some((diagnostic) => diagnostic.entry === record.manifest.name && isTransient(diagnostic)),
  );
  const records = [...next.records, ...retained].sort((left, right) =>
    left.descriptor.id.localeCompare(right.descriptor.id),
  );
  return {
    ...next,
    records,
    skills: records.map((record) => record.descriptor),
    totalBytes: records.reduce((total, record) => total + record.size, 0),
  };
}

function sourceEnabled(trust: SkillTrustSnapshot, project: ProjectContext | undefined): boolean {
  return (
    !!project &&
    trust.status === "ok" &&
    trust.sources.some((source) => source.workspaceId === project.workspaceId && source.root === project.canonicalRoot)
  );
}

function trustIdentity(project: ProjectContext, descriptor: SkillDescriptor) {
  return {
    workspaceId: project.workspaceId,
    root: project.canonicalRoot,
    skillId: descriptor.id,
    fingerprint: descriptor.fingerprint,
  };
}

export function createSkillHost(deps: SkillHostDeps): SkillHost {
  let trust: SkillTrustSnapshot = { status: "missing", path: "", sources: [], skills: [] };
  let userSource: SkillSourceSnapshot | undefined;
  let projectSource: SkillSourceSnapshot | undefined;
  let project: ProjectContext | undefined;
  let view = emptySnapshot(deps.userRoot);
  let revision = 0;
  let signature = "";
  let reloadTask: Promise<SkillHostSnapshot> | undefined;
  let watchTimer: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let observedSourceSignature = "";
  let polling = false;
  let disposed = false;
  const listeners = new Set<(snapshot: SkillHostSnapshot) => void>();

  const sourceTreeSignature = async (root: string): Promise<unknown> => {
    try {
      const rootStat = await deps.fs.lstat(root);
      const entries = await deps.fs.listDirectory(root);
      const children = await Promise.all(
        entries
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(async (entry) => {
            if (entry.kind !== "directory") return [entry.name, entry.kind];
            const file = await deps.path.join(root, entry.name, "SKILL.md");
            try {
              const stat = await deps.fs.lstat(file);
              return [entry.name, entry.kind, stat.kind, stat.size, stat.modifiedMs];
            } catch {
              return [entry.name, entry.kind, "missing"];
            }
          }),
      );
      return [root, rootStat.kind, rootStat.modifiedMs, children];
    } catch {
      return [root, "missing"];
    }
  };

  const currentSourceSignature = async (): Promise<string> => {
    const workspaceRoot = (await deps.getWorkspaceRoot())?.trim();
    const projectRoot = workspaceRoot ? await deps.path.join(workspaceRoot, ".container-desktop", "skills") : undefined;
    return JSON.stringify([
      await sourceTreeSignature(deps.userRoot),
      workspaceRoot ?? "",
      ...(projectRoot ? [await sourceTreeSignature(projectRoot)] : []),
    ]);
  };

  const findProjectContext = async (): Promise<ProjectContext | undefined> => {
    const configured = (await deps.getWorkspaceRoot())?.trim();
    if (!configured) return undefined;
    try {
      const canonicalWorkspace = await deps.fs.realPath(configured);
      const root = await deps.path.join(canonicalWorkspace, ".container-desktop", "skills");
      const stat = await deps.fs.lstat(root);
      if (stat.kind !== "directory") return undefined;
      const canonicalRoot = await deps.fs.realPath(root);
      if (!(await deps.fs.isPathWithin(canonicalWorkspace, canonicalRoot))) return undefined;
      return { workspaceId: await sha256Text(`workspace:${canonicalWorkspace}`), root, canonicalRoot };
    } catch {
      return undefined;
    }
  };

  const publish = (): SkillHostSnapshot => {
    const projectEnabled = sourceEnabled(trust, project);
    const raw = [...(projectSource?.records ?? []), ...(userSource?.records ?? [])]
      .map((record): SkillViewDescriptor => {
        const enabled = record.descriptor.source.kind !== "project" || projectEnabled;
        const trusted =
          record.descriptor.source.kind !== "project" ||
          (!!project && isProjectSkillTrusted(trust, trustIdentity(project, record.descriptor)));
        return { ...record.descriptor, enabled, trusted };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const executableNameCounts = new Map<string, number>();
    for (const skill of raw) {
      if (skill.enabled && skill.trusted) {
        executableNameCounts.set(skill.name, (executableNameCounts.get(skill.name) ?? 0) + 1);
      }
    }
    const skills = raw.map((skill) =>
      executableNameCounts.get(skill.name) === 1 ? skill : { ...skill, shortCommand: undefined },
    );
    const diagnostics = [...(userSource?.diagnostics ?? []), ...(projectSource?.diagnostics ?? [])];
    const next = {
      user: {
        root: userSource?.canonicalRoot ?? deps.userRoot,
        status: userSource?.status ?? ("error" as const),
      },
      skills,
      diagnostics,
      ...(project
        ? {
            project: {
              workspaceId: project.workspaceId,
              root: project.canonicalRoot,
              enabled: projectEnabled,
              status: projectSource?.status ?? ("error" as const),
            },
          }
        : {}),
    };
    const nextSignature = JSON.stringify(next);
    if (nextSignature !== signature) {
      signature = nextSignature;
      revision += 1;
      view = { revision: String(revision), ...next };
      for (const listener of listeners) listener(structuredClone(view));
    }
    return structuredClone(view);
  };

  const performReload = async (): Promise<SkillHostSnapshot> => {
    const discoveredUser = await discoverSkillSource({ source: { kind: "user" }, root: deps.userRoot, ...deps });
    userSource = withLastKnownGood(userSource, discoveredUser);
    project = await findProjectContext();
    if (project) {
      const discoveredProject = await discoverSkillSource({
        source: { kind: "project", workspaceId: project.workspaceId },
        root: project.canonicalRoot,
        ...deps,
      });
      projectSource = withLastKnownGood(projectSource, discoveredProject);
    } else {
      projectSource = undefined;
    }
    return publish();
  };

  const reload = (): Promise<SkillHostSnapshot> => {
    if (reloadTask) return reloadTask;
    reloadTask = performReload().finally(() => {
      reloadTask = undefined;
    });
    return reloadTask;
  };

  const pollSources = async (): Promise<void> => {
    if (disposed || polling) return;
    polling = true;
    try {
      const nextSignature = await currentSourceSignature();
      if (nextSignature === observedSourceSignature) return;
      observedSourceSignature = nextSignature;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void reload().catch((cause) => deps.logger?.error("AI: skill reload after source change failed", cause));
      }, deps.watchDebounceMs ?? WATCH_DEBOUNCE_MS);
    } catch (cause) {
      deps.logger?.error("AI: skill source watch failed", cause);
    } finally {
      polling = false;
    }
  };

  const startWatching = async (): Promise<void> => {
    if (watchTimer || disposed) return;
    observedSourceSignature = await currentSourceSignature();
    watchTimer = setInterval(() => void pollSources(), deps.watchIntervalMs ?? WATCH_INTERVAL_MS);
  };

  const persistTrust = async (next: SkillTrustSnapshot): Promise<SkillHostSnapshot> => {
    if (trust.status === "error") throw new Error("AI: skill trust record is unreadable");
    await deps.trustStore.save(next);
    trust = { ...next, status: "ok" };
    return publish();
  };

  const requireProject = (): ProjectContext => {
    if (!project) throw new Error("AI: project skills are unavailable");
    return project;
  };

  const recordById = (skillId: string): SkillRecord | undefined =>
    [...(userSource?.records ?? []), ...(projectSource?.records ?? [])].find(
      (record) => record.descriptor.id === skillId,
    );

  return {
    async ready() {
      await deps.fs.mkdir(deps.userRoot, { recursive: true });
      trust = await deps.trustStore.load();
      if (trust.status === "missing") trust = { ...trust, status: "ok" };
      await reload();
      if (deps.watch !== false) await startWatching();
    },
    startWatching,
    snapshot: () => structuredClone(view),
    reload,
    async setProjectSourceEnabled(enabled) {
      const context = requireProject();
      const sources = trust.sources.filter(
        (source) => source.workspaceId !== context.workspaceId || source.root !== context.canonicalRoot,
      );
      const skills = enabled
        ? trust.skills
        : trust.skills.filter(
            (skill) => skill.workspaceId !== context.workspaceId || skill.root !== context.canonicalRoot,
          );
      if (enabled)
        sources.push({ workspaceId: context.workspaceId, root: context.canonicalRoot, enabledAt: Date.now() });
      return persistTrust({ ...trust, status: "ok", sources, skills });
    },
    async setProjectSkillTrust(skillId, expectedFingerprint, trusted) {
      const context = requireProject();
      if (!sourceEnabled(trust, context)) throw new Error("AI: project skill source is disabled");
      const record = projectSource?.records.find((candidate) => candidate.descriptor.id === skillId);
      if (!record || record.descriptor.fingerprint !== expectedFingerprint) throw new Error("AI: skill changed");
      const skills = trust.skills.filter(
        (skill) =>
          skill.workspaceId !== context.workspaceId ||
          skill.root !== context.canonicalRoot ||
          skill.skillId !== skillId,
      );
      if (trusted) skills.push({ ...trustIdentity(context, record.descriptor), trustedAt: Date.now() });
      return persistTrust({ ...trust, status: "ok", skills });
    },
    async resolveInvocation(request) {
      if (new TextEncoder().encode(request.arguments).byteLength > SKILL_LIMITS.argumentBytes) {
        throw new Error("AI: skill arguments are too large");
      }
      const current = recordById(request.skillId);
      if (!current || current.descriptor.fingerprint !== request.expectedFingerprint)
        throw new Error("AI: skill changed");
      const isProject = current.descriptor.source.kind === "project";
      const context = isProject ? requireProject() : undefined;
      if (context) {
        const currentProject = await findProjectContext();
        if (
          !currentProject ||
          currentProject.workspaceId !== context.workspaceId ||
          currentProject.canonicalRoot !== context.canonicalRoot
        ) {
          await reload();
          throw new Error("AI: workspace changed before skill invocation");
        }
      }
      if (context && !isProjectSkillTrusted(trust, trustIdentity(context, current.descriptor))) {
        throw new Error("AI: project skill is not trusted");
      }
      const source = isProject ? projectSource : userSource;
      if (!source?.canonicalRoot) throw new Error("AI: skill source is unavailable");
      const diagnostics: SkillDiagnostic[] = [];
      const fresh = await readSkillRecord(
        { source: current.descriptor.source, root: source.canonicalRoot, ...deps },
        source.canonicalRoot,
        current.manifest.name,
        diagnostics,
      );
      if (
        !fresh ||
        diagnostics.length > 0 ||
        fresh.descriptor.fingerprint !== request.expectedFingerprint ||
        fresh.canonicalFilePath !== current.canonicalFilePath
      ) {
        await reload();
        throw new Error("AI: skill changed during invocation");
      }
      return {
        descriptor: fresh.descriptor,
        manifest: fresh.manifest,
        arguments: request.arguments,
        initialTaint: isProject,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (watchTimer) clearInterval(watchTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      watchTimer = undefined;
      debounceTimer = undefined;
      listeners.clear();
    },
  };
}

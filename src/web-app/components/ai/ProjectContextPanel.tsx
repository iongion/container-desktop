import {
  Button,
  ButtonGroup,
  Callout,
  Icon,
  Intent,
  NonIdealState,
  Spinner,
  Switch,
  Tag,
  TextArea,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@/ai-system/core/errors";
import {
  type ProjectContextSnapshot,
  type ProjectMemoryEntry,
  prepareProjectMemoryExport,
} from "@/ai-system/core/projectContext";
import { createLogger } from "@/logger";
import { getHostRuntime } from "@/platform/provider";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";

import "./ProjectContextPanel.css";

const logger = createLogger("web.ai.project-context");

export type ProjectContextView = "preview" | "memory" | "rules";

export interface ProjectContextRequest {
  view: ProjectContextView;
  memoryDraft?: string;
  memoryId?: string;
  action?: "clear-memory";
}

interface ProjectContextPanelProps {
  initialRequest?: ProjectContextRequest;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function timestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function ProjectContextUnavailable({ snapshot }: { snapshot: Exclude<ProjectContextSnapshot, { state: "ready" }> }) {
  const { t } = useTranslation();
  return (
    <NonIdealState
      icon={IconNames.DISABLE}
      title={snapshot.state === "unconfigured" ? t("No project is configured") : t("Project context is unavailable")}
      description={t(snapshot.message)}
    />
  );
}

function PackPreview({ snapshot }: { snapshot: Extract<ProjectContextSnapshot, { state: "ready" }> }) {
  const { t } = useTranslation();
  const pack = snapshot.pack;
  return (
    <div className="ProjectContextStack">
      <div className="ProjectContextStats">
        <div>
          <span>{t("Included sources")}</span>
          <strong>{pack.sections.length}</strong>
        </div>
        <div>
          <span>{t("Pack budget")}</span>
          <strong>
            {formatBytes(pack.usedBytes)} / {formatBytes(pack.budgetBytes)}
          </strong>
        </div>
        <div>
          <span>{t("Omitted sources")}</span>
          <strong>{pack.omittedSources}</strong>
        </div>
      </div>
      <Callout
        compact
        icon={pack.initialTaint ? IconNames.SHIELD : IconNames.TICK}
        intent={pack.initialTaint ? Intent.WARNING : Intent.SUCCESS}
      >
        {pack.initialTaint
          ? t("This project context initially taints model work and cannot widen tool access.")
          : t("No persistent project context is included.")}
      </Callout>
      <section className="ProjectContextCard">
        <header>
          <strong>{t("Exact context pack")}</strong>
          <Tag minimal>{pack.fingerprint.slice(0, 12)}</Tag>
        </header>
        {pack.sections.length ? (
          <div className="ProjectContextSourceList">
            {pack.sections.map((section) => (
              <details key={`${section.kind}:${section.source}`}>
                <summary>
                  <Icon icon={section.kind === "rules" ? IconNames.DOCUMENT : IconNames.BOOK} size={16} />
                  <span>
                    <strong>{section.source}</strong>
                    <small>
                      {t(section.trust)} · {formatBytes(section.includedBytes)}
                      {section.truncated ? ` · ${t("truncated")}` : ""}
                    </small>
                  </span>
                  <time dateTime={new Date(section.modifiedAt).toISOString()}>{timestamp(section.modifiedAt)}</time>
                </summary>
                <div className="ProjectContextSourceMeta">
                  <code>{section.fingerprint}</code>
                  <span>
                    {t("{{included}} of {{original}}", {
                      included: formatBytes(section.includedBytes),
                      original: formatBytes(section.originalBytes),
                    })}
                  </span>
                </div>
                <pre>{section.content}</pre>
              </details>
            ))}
          </div>
        ) : (
          <div className="ProjectContextEmpty">{t("No Project Rules or Project Memory enter the next request.")}</div>
        )}
      </section>
    </div>
  );
}

interface MemoryPanelProps {
  snapshot: Extract<ProjectContextSnapshot, { state: "ready" }>;
  initialDraft: string;
  initialMemoryId?: string;
  clearRequested: boolean;
  busy: boolean;
  onMutate: (operation: () => Promise<ProjectContextSnapshot>) => Promise<boolean>;
}

function MemoryPanel({ snapshot, initialDraft, initialMemoryId, clearRequested, busy, onMutate }: MemoryPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialDraft);
  const memory = useMemo(
    () =>
      [...snapshot.memory].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)),
    [snapshot.memory],
  );

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (await onMutate(() => window.AI.addProjectMemory(content))) setDraft("");
  };

  const importMemory = async () => {
    await onMutate(async () => {
      const runtime = getHostRuntime();
      const selection = await runtime.dialogs.openFileSelector({
        filters: [{ name: t("JSON files"), extensions: ["json"] }],
      });
      const path = selection?.filePaths[0];
      if (selection?.canceled || !path) return snapshot;
      const content = await runtime.fs.readTextFile(path);
      return window.AI.importProjectMemory(content);
    });
  };

  const exportMemory = async () => {
    await onMutate(async () => {
      const runtime = getHostRuntime();
      const selection = await runtime.dialogs.saveFileSelector({
        defaultPath: "container-desktop-project-memory.json",
        filters: [{ name: t("JSON files"), extensions: ["json"] }],
      });
      if (selection?.canceled || !selection?.filePath) return snapshot;
      const content = JSON.stringify(prepareProjectMemoryExport(snapshot.memory), null, 2);
      await runtime.fs.writeTextFile(selection.filePath, `${content}\n`);
      return snapshot;
    });
  };

  return (
    <div className="ProjectContextStack">
      <form className="ProjectMemoryComposer" onSubmit={(event) => void add(event)}>
        <TextArea
          fill
          value={draft}
          placeholder={t("Add a fact or instruction you want this project to remember")}
          aria-label={t("Project Memory entry")}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Button
          type="submit"
          intent={Intent.SUCCESS}
          icon={IconNames.ADD}
          text={t("Add to Project Memory")}
          disabled={!draft.trim()}
          loading={busy}
        />
      </form>
      <div className="ProjectContextToolbar">
        <ButtonGroup variant="outlined">
          <Button icon={IconNames.IMPORT} text={t("Import")} disabled={busy} onClick={() => void importMemory()} />
          <Button
            icon={IconNames.EXPORT}
            text={t("Export")}
            disabled={busy || memory.length === 0}
            onClick={() => void exportMemory()}
          />
        </ButtonGroup>
        <ConfirmMenu
          disabled={busy || memory.length === 0}
          title={t("Clear Project Memory")}
          actionText={t("Clear Project Memory")}
          onConfirm={(_tag, confirmed) => confirmed && void onMutate(() => window.AI.clearProjectMemory())}
        />
      </div>
      {clearRequested ? (
        <Callout compact intent={Intent.WARNING}>
          {t("Review these {{count}} entries, then use the actions menu to clear Project Memory.", {
            count: memory.length,
          })}
        </Callout>
      ) : null}
      <section className="ProjectContextCard">
        <header>
          <strong>{t("Project Memory")}</strong>
          <Tag minimal>{memory.length}</Tag>
        </header>
        {memory.length ? (
          <div className="ProjectMemoryList">
            {memory.map((entry) => (
              <article
                className={initialMemoryId && entry.id.startsWith(initialMemoryId) ? "is-targeted" : undefined}
                key={entry.id}
              >
                <div className="ProjectMemoryEntryBody">
                  <p>{entry.content}</p>
                  <div>
                    <Tag minimal>{t(entry.source)}</Tag>
                    <code title={entry.id}>{entry.id.slice(0, 12)}</code>
                    <time dateTime={new Date(entry.updatedAt).toISOString()}>{timestamp(entry.updatedAt)}</time>
                  </div>
                </div>
                <ConfirmMenu
                  tag={entry}
                  title={t("Remove from Project Memory")}
                  actionText={t("Remove from Project Memory")}
                  disabled={busy}
                  onConfirm={(tag, confirmed) =>
                    confirmed && void onMutate(() => window.AI.removeProjectMemory((tag as ProjectMemoryEntry).id))
                  }
                />
              </article>
            ))}
          </div>
        ) : (
          <div className="ProjectContextEmpty">{t("Project Memory is empty.")}</div>
        )}
      </section>
    </div>
  );
}

interface RulesPanelProps {
  snapshot: Extract<ProjectContextSnapshot, { state: "ready" }>;
  busy: boolean;
  onMutate: (operation: () => Promise<ProjectContextSnapshot>) => Promise<boolean>;
  onInitialize: () => Promise<void>;
}

function RulesPanel({ snapshot, busy, onMutate, onInitialize }: RulesPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="ProjectContextStack">
      <section className="ProjectRulesControl">
        <Switch
          large
          checked={snapshot.rulesEnabled}
          disabled={busy}
          label={t("Include Project Rules")}
          onChange={(event) => void onMutate(() => window.AI.setProjectRulesEnabled(event.currentTarget.checked))}
        />
        <p>{t("Project Rules are untrusted context. They cannot grant tools or bypass approvals.")}</p>
        <Button
          variant="outlined"
          icon={IconNames.NEW_OBJECT}
          intent={Intent.PRIMARY}
          text={t("Initialize Project Rules")}
          disabled={busy}
          loading={busy}
          onClick={() => void onInitialize()}
        />
      </section>
      <section className="ProjectContextCard">
        <header>
          <strong>{t("Discovered rule files")}</strong>
          <Tag minimal>{snapshot.rules.length}</Tag>
        </header>
        {snapshot.rules.length ? (
          <div className="ProjectRuleList">
            {snapshot.rules.map((rule) => (
              <div key={rule.path}>
                <Icon
                  icon={rule.status === "ready" ? IconNames.DOCUMENT : IconNames.WARNING_SIGN}
                  intent={rule.status === "ready" ? Intent.NONE : Intent.WARNING}
                />
                <span>
                  <strong>{rule.path}</strong>
                  <small>
                    {t(rule.status)}
                    {rule.size === undefined ? "" : ` · ${formatBytes(rule.size)}`}
                  </small>
                </span>
                <Tag minimal intent={rule.included ? Intent.SUCCESS : Intent.NONE}>
                  {rule.included ? t("included") : t("not included")}
                </Tag>
              </div>
            ))}
          </div>
        ) : (
          <div className="ProjectContextEmpty">{t("No supported Project Rules were found.")}</div>
        )}
      </section>
    </div>
  );
}

export function ProjectContextPanel({ initialRequest }: ProjectContextPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<ProjectContextView>(initialRequest?.view ?? "preview");
  const [snapshot, setSnapshot] = useState<ProjectContextSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await window.AI.getProjectContext());
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Project context load failed", { error: message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(async (operation: () => Promise<ProjectContextSnapshot>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await operation());
      return true;
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Project context mutation failed", { error: message });
      setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const initialize = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.AI.initializeProjectRules();
      setSnapshot(result.snapshot);
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Project Rules initialization failed", { error: message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="ProjectContextPanel" data-testid="project-context-panel">
      <ButtonGroup fill variant="minimal" className="AppSegmentedControl" aria-label={t("Project context section")}>
        <Button
          active={view === "preview"}
          intent={view === "preview" ? Intent.PRIMARY : Intent.NONE}
          icon={IconNames.EYE_OPEN}
          onClick={() => setView("preview")}
        >
          {t("Preview")}
        </Button>
        <Button
          active={view === "memory"}
          intent={view === "memory" ? Intent.PRIMARY : Intent.NONE}
          icon={IconNames.BOOK}
          onClick={() => setView("memory")}
        >
          {t("Memory")}
        </Button>
        <Button
          active={view === "rules"}
          intent={view === "rules" ? Intent.PRIMARY : Intent.NONE}
          icon={IconNames.DOCUMENT}
          onClick={() => setView("rules")}
        >
          {t("Rules")}
        </Button>
      </ButtonGroup>
      {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
      {!snapshot && busy ? (
        <Spinner size={32} />
      ) : !snapshot ? (
        <NonIdealState icon={IconNames.ERROR} title={t("Project context could not be loaded")} />
      ) : snapshot.state !== "ready" ? (
        <ProjectContextUnavailable snapshot={snapshot} />
      ) : view === "preview" ? (
        <PackPreview snapshot={snapshot} />
      ) : view === "memory" ? (
        <MemoryPanel
          snapshot={snapshot}
          initialDraft={initialRequest?.memoryDraft ?? ""}
          initialMemoryId={initialRequest?.memoryId}
          clearRequested={initialRequest?.action === "clear-memory"}
          busy={busy}
          onMutate={mutate}
        />
      ) : (
        <RulesPanel snapshot={snapshot} busy={busy} onMutate={mutate} onInitialize={initialize} />
      )}
    </div>
  );
}

import { Button, ButtonGroup, Callout, Classes, Icon, Intent, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/ai-system/core/errors";
import type { WorkerExecutionTarget } from "@/ai-system/core/workers";
import type {
  WorkspaceChangeEntry,
  WorkspaceChangeSnapshot,
  WorkspaceChangeState,
  WorkspaceChangeSummary,
  WorkspaceDiff,
} from "@/ai-system/core/workspaceChanges";
import { createLogger } from "@/logger";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import "./WorkspaceChangesDrawer.css";

const logger = createLogger("web.ai.workspace-changes");

export type WorkspaceChangesView = "status" | "diff";

interface WorkspaceChangesDrawerProps {
  initialView: WorkspaceChangesView;
  onClose: () => void;
}

interface WorkspaceChangesCardProps {
  summary: WorkspaceChangeSummary;
  onOpen: () => void;
}

function targetLabel(target: WorkerExecutionTarget, t: (key: string) => string): string {
  switch (target.kind) {
    case "host":
      return t("This computer");
    case "remote":
      return `${t("Remote host")}: ${target.connectionId}`;
    case "container":
      return `${t("Container")}: ${target.containerId}`;
    case "sandbox":
      return `${t("Sandbox")}: ${target.image}`;
  }
}

function stateLabel(state: WorkspaceChangeState, t: (key: string) => string): string {
  const labels: Record<WorkspaceChangeState, string> = {
    unchanged: t("unchanged"),
    added: t("added"),
    modified: t("modified"),
    deleted: t("deleted"),
    renamed: t("renamed"),
    copied: t("copied"),
    "type-changed": t("type changed"),
    conflicted: t("conflicted"),
    untracked: t("untracked"),
  };
  return labels[state];
}

function changeTags(entry: WorkspaceChangeEntry, t: (key: string) => string) {
  if (entry.index === "untracked") return <Tag minimal>{t("untracked")}</Tag>;
  return (
    <span className="WorkspaceChangeTags">
      {entry.index !== "unchanged" ? (
        <Tag minimal>
          {t("staged")} · {stateLabel(entry.index, t)}
        </Tag>
      ) : null}
      {entry.worktree !== "unchanged" ? (
        <Tag minimal>
          {t("working tree")} · {stateLabel(entry.worktree, t)}
        </Tag>
      ) : null}
    </span>
  );
}

function StatusView({ status }: { status: WorkspaceChangeSnapshot }) {
  const { t } = useTranslation();
  if (status.state === "not-repository" || status.state === "unavailable") {
    return (
      <NonIdealState
        icon={status.state === "not-repository" ? IconNames.GIT_BRANCH : IconNames.ERROR}
        title={status.state === "not-repository" ? t("Not a Git repository") : t("Workspace changes unavailable")}
        description={status.message}
      />
    );
  }
  if (status.state === "clean") {
    return <NonIdealState icon={IconNames.TICK_CIRCLE} title={t("Workspace is clean")} />;
  }
  return (
    <div className="WorkspaceChangeList">
      {status.entries.map((entry) => (
        <div className="WorkspaceChangeRow" key={`${entry.path}:${entry.previousPath ?? ""}`}>
          <Icon icon={entry.index === "untracked" ? IconNames.NEW_OBJECT : IconNames.DOCUMENT} size={14} />
          <div className="WorkspaceChangePath">
            <code>{entry.path}</code>
            {entry.previousPath ? <span>{t("from {{path}}", { path: entry.previousPath })}</span> : null}
          </div>
          {changeTags(entry, t)}
        </div>
      ))}
    </div>
  );
}

function DiffSection({ title, value }: { title: string; value: string }) {
  const { t } = useTranslation();
  return (
    <section className="WorkspaceDiffSection">
      <h5>{title}</h5>
      {value ? (
        <div className="WorkspaceDiffEditor">
          <CodeEditor value={value} mode="diff" readOnly />
        </div>
      ) : (
        <span className="WorkspaceChangesEmptySection">{t("No changes")}</span>
      )}
    </section>
  );
}

function DiffView({ diff }: { diff: WorkspaceDiff }) {
  const { t } = useTranslation();
  if (diff.state === "not-repository" || diff.state === "unavailable") {
    return (
      <NonIdealState
        icon={diff.state === "not-repository" ? IconNames.GIT_BRANCH : IconNames.ERROR}
        title={diff.state === "not-repository" ? t("Not a Git repository") : t("Workspace diff unavailable")}
        description={diff.message}
      />
    );
  }
  if (diff.state === "clean") {
    return <NonIdealState icon={IconNames.TICK_CIRCLE} title={t("Workspace is clean")} />;
  }
  if (!("staged" in diff)) return null;
  return (
    <div className="WorkspaceDiff">
      <DiffSection title={t("Staged changes")} value={diff.staged} />
      <DiffSection title={t("Working tree changes")} value={diff.unstaged} />
      {diff.untracked.length ? (
        <section className="WorkspaceDiffUntracked">
          <h5>{t("Untracked files")}</h5>
          {diff.untracked.map((path) => (
            <code key={path}>{path}</code>
          ))}
          <span>{t("Untracked files are listed separately because Git has no native diff for them.")}</span>
        </section>
      ) : null}
    </div>
  );
}

export function WorkspaceChangesDrawer({ initialView, onClose }: WorkspaceChangesDrawerProps) {
  const { t } = useTranslation();
  const [view, setView] = useState(initialView);
  const [status, setStatus] = useState<WorkspaceChangeSnapshot>();
  const [diff, setDiff] = useState<WorkspaceDiff>();
  const [error, setError] = useState<string>();
  const loading = view === "status" ? !status : !diff;

  useEffect(() => {
    if ((view === "status" && status) || (view === "diff" && diff)) return;
    let active = true;
    setError(undefined);
    const request = view === "status" ? window.AI.getWorkspaceChangeStatus() : window.AI.getWorkspaceDiff();
    void request
      .then((result) => {
        if (!active) return;
        if (view === "status") setStatus(result as WorkspaceChangeSnapshot);
        else setDiff(result as WorkspaceDiff);
      })
      .catch((cause) => {
        const message = describeError(cause);
        logger.error("Workspace change review failed", { error: message });
        if (active) setError(message);
      });
    return () => {
      active = false;
    };
  }, [diff, status, view]);

  const current = view === "status" ? status : diff;
  const location = status ?? diff;
  const facts = useMemo(() => {
    if (!location) return [];
    return [
      { label: t("Execution target"), value: targetLabel(location.target, t) },
      { label: t("Workspace"), value: location.workspaceRoot },
    ];
  }, [location, t]);

  return (
    <AppDrawer
      className="WorkspaceChangesDrawer"
      title={t("Workspace changes")}
      icon={IconNames.CHANGES}
      size={DrawerSize.SMALL}
      onClose={onClose}
    >
      <div className={Classes.DRAWER_BODY}>
        <div className={Classes.DIALOG_BODY}>
          <ButtonGroup fill variant="minimal" className="AppSegmentedControl" aria-label={t("Workspace change view")}>
            <Button
              icon={IconNames.LIST}
              text={t("Status")}
              active={view === "status"}
              intent={view === "status" ? Intent.PRIMARY : Intent.NONE}
              onClick={() => setView("status")}
            />
            <Button
              icon={IconNames.COMPARISON}
              text={t("Diff")}
              active={view === "diff"}
              intent={view === "diff" ? Intent.PRIMARY : Intent.NONE}
              onClick={() => setView("diff")}
            />
          </ButtonGroup>
          {facts.length ? (
            <div className="AppDataForm WorkspaceChangesFacts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <span>{fact.label}</span>
                  <code>{fact.value}</code>
                </div>
              ))}
            </div>
          ) : null}
          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
          {loading && !error ? <Spinner size={24} /> : null}
          {!loading && !error && current?.truncated ? (
            <Callout intent={Intent.WARNING}>{t("Results were truncated to the safe display limit.")}</Callout>
          ) : null}
          {!loading && !error && view === "status" && status ? <StatusView status={status} /> : null}
          {!loading && !error && view === "diff" && diff ? <DiffView diff={diff} /> : null}
        </div>
      </div>
    </AppDrawer>
  );
}

export function WorkspaceChangesCard({ summary, onOpen }: WorkspaceChangesCardProps) {
  const { t } = useTranslation();
  const pathChanges = summary.introduced.length + summary.cleared.length + summary.updated.length;
  const detail = summary.contentChanged
    ? t("File contents changed")
    : t("{{count}} paths changed", { count: pathChanges });
  return (
    <button type="button" className="WorkspaceChangesCard" onClick={onOpen}>
      <Icon icon={IconNames.CHANGES} size={16} />
      <span className="WorkspaceChangesCardBody">
        <strong>{t("Workspace changes")}</strong>
        <span>
          {detail} · {t("{{count}} total", { count: summary.afterCount })}
        </span>
      </span>
      <Tag minimal>{targetLabel(summary.target, t)}</Tag>
      <Icon icon={IconNames.CHEVRON_RIGHT} size={14} />
    </button>
  );
}

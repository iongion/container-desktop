import { Button, Collapse, Icon, type Intent, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ActivityEntry } from "@/web-app/stores/activityTypes";
import { formatRelativeTime } from "./activityFilters";
import { friendlyEndpoint } from "./endpointLabels";

function primaryText(entry: ActivityEntry): string {
  switch (entry.kind) {
    case "api":
      return friendlyEndpoint(entry.method, entry.url) ?? `${entry.method} ${entry.url}`;
    case "cli":
      return entry.commandLine;
    case "notification":
      return entry.message;
    default:
      return entry.title;
  }
}

function secondaryText(entry: ActivityEntry): string | null {
  switch (entry.kind) {
    case "api":
      return `${entry.method} ${entry.url}`;
    case "cli":
      return entry.invocation;
    case "system":
      return entry.eventType;
    default:
      return null;
  }
}

function formatDuration(ms?: number): string | null {
  if (typeof ms !== "number") {
    return null;
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${ms}ms`;
}

function isExpandable(entry: ActivityEntry): boolean {
  if (entry.kind === "api" || entry.kind === "cli") {
    return true;
  }
  return entry.kind === "system" && entry.data != null;
}

function safeJson(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StatusBadge({ entry }: { entry: ActivityEntry }) {
  if (entry.kind === "api") {
    if (entry.status === "pending") {
      return <Tag minimal>…</Tag>;
    }
    const intent: Intent = entry.severity === "error" ? "danger" : entry.severity === "warning" ? "warning" : "success";
    return (
      <Tag intent={intent} minimal>
        {entry.httpStatus ?? (entry.status === "error" ? "ERR" : "—")}
      </Tag>
    );
  }
  if (entry.kind === "cli") {
    if (entry.status === "pending") {
      return <Tag minimal>…</Tag>;
    }
    return (
      <Tag intent={entry.status === "error" ? "danger" : "success"} minimal>
        exit {entry.exitCode ?? 0}
      </Tag>
    );
  }
  return null;
}

function DetailBlock({ label, value, action }: { label: string; value?: string; action?: ReactNode }) {
  if (!value && !action) {
    return null;
  }
  return (
    <div className="ActivityDetailBlock">
      <div className="ActivityDetailLabel">
        <span>{label}</span>
        {action}
      </div>
      {value ? <pre className="ActivityDetailPre">{value}</pre> : null}
    </div>
  );
}

export function ActivityRow({ entry, count = 1 }: { entry: ActivityEntry; count?: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const expandable = isExpandable(entry);
  const secondary = secondaryText(entry);
  const duration = formatDuration("durationMs" in entry ? entry.durationMs : undefined);

  const copy = (text: string | undefined, key: string) => {
    if (!text) {
      return;
    }
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1500);
      },
      () => undefined,
    );
  };

  const copyIcon = (key: string) => (copied === key ? IconNames.TICK : IconNames.DUPLICATE);

  // Icon-only copy button rendered inline on a DetailBlock's label line (saves the vertical
  // space of a standalone action row); the action text lives in the tooltip.
  const copyAction = (key: string, text: string | undefined): ReactNode =>
    text ? (
      <Button
        className="ActivityCopyButton"
        variant="minimal"
        size="small"
        icon={copyIcon(key)}
        title={copied === key ? t("Copied") : t("Copy")}
        aria-label={t("Copy")}
        onClick={() => copy(text, key)}
      />
    ) : undefined;

  const headerInner = (
    <>
      <span className="ActivityRowDot" data-severity={entry.severity} />
      <span className="ActivityRowMain">
        <span className="ActivityRowPrimary">
          {primaryText(entry)}
          {count > 1 ? (
            <Tag round minimal className="ActivityRowCount">
              ×{count}
            </Tag>
          ) : null}
        </span>
        {secondary ? <span className="ActivityRowSecondary">{secondary}</span> : null}
      </span>
      <span className="ActivityRowMeta">
        <StatusBadge entry={entry} />
        {duration ? (
          <Tag minimal className="ActivityRowDuration">
            {duration}
          </Tag>
        ) : null}
        <span className="ActivityRowTime" title={new Date(entry.date).toLocaleString()}>
          {formatRelativeTime(entry.date)}
        </span>
        {expandable ? <Icon icon={expanded ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN} size={12} /> : null}
      </span>
    </>
  );

  return (
    <div className="ActivityRow" data-kind={entry.kind} data-severity={entry.severity} data-expandable={expandable}>
      {expandable ? (
        <button
          type="button"
          className="ActivityRowHeader"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {headerInner}
        </button>
      ) : (
        <div className="ActivityRowHeader">{headerInner}</div>
      )}
      {expandable ? (
        <Collapse isOpen={expanded}>
          <div className="ActivityRowDetail">
            {entry.kind === "api" ? (
              <>
                <DetailBlock label={t("Equivalent cURL")} value={entry.curl} action={copyAction("curl", entry.curl)} />
                <DetailBlock label={t("Request body")} value={entry.requestBody} />
                <DetailBlock label={t("Response body")} value={entry.responseBody} />
                {entry.error ? <DetailBlock label={t("Error")} value={entry.error} /> : null}
              </>
            ) : null}
            {entry.kind === "cli" ? (
              entry.status === "error" ? (
                <>
                  <DetailBlock
                    label="stdout"
                    value={entry.stdoutPreview}
                    action={copyAction("cmd", entry.commandLine)}
                  />
                  <DetailBlock label="stderr" value={entry.stderrPreview} />
                </>
              ) : (
                // Successful commands: show the command (copyable) but not the output.
                <DetailBlock
                  label={t("Command")}
                  value={entry.commandLine}
                  action={copyAction("cmd", entry.commandLine)}
                />
              )
            ) : null}
            {entry.kind === "system" ? <DetailBlock label={entry.eventType} value={safeJson(entry.data)} /> : null}
          </div>
        </Collapse>
      ) : null}
    </div>
  );
}

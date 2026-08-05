import { Button, Callout, Classes, Icon, Intent, Spinner, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AIDiagnosticsSnapshot } from "@/ai-system/core/diagnostics";
import { getProviderEntry } from "@/ai-system/core/providers";
import type { SessionProviderCheck } from "@/pi-bridge/protocol";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { groupDiagnosticErrors } from "@/web-app/components/ai/diagnosticErrors";
import { sessionRelativeAge } from "@/web-app/components/ai/sessionHistory";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

import "./AssistantDiagnosticsDrawer.css";

interface AssistantDiagnosticsDrawerProps {
  providerId?: string;
  onClose: () => void;
}

function StateTag({ state }: { state: string }) {
  const { t } = useTranslation();
  const intent = ["reachable", "ok", "stored", "available", "enabled"].includes(state)
    ? Intent.SUCCESS
    : ["unreachable", "missing", "error", "degraded"].includes(state)
      ? Intent.DANGER
      : Intent.NONE;
  return (
    <Tag minimal intent={intent}>
      {t(state)}
    </Tag>
  );
}

function CapabilityRow({ label, available }: { label: string; available: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="AssistantDiagnosticRow">
      <Icon
        icon={available ? IconNames.TICK_CIRCLE : IconNames.DISABLE}
        intent={available ? Intent.SUCCESS : Intent.NONE}
      />
      <span>{t(label)}</span>
      <StateTag state={available ? "available" : "unavailable"} />
    </div>
  );
}

// What the SESSION answered, which is a different question from what the app can reach: a turn dials the provider
// from the agent container, through the gateway, with the credential the gateway substitutes. `undefined` means no
// session is running, so there is nothing to ask.
function sessionReachability(check: SessionProviderCheck | undefined): "reachable" | "unreachable" | "not-checked" {
  if (!check) return "not-checked";
  return check.reachable ? "reachable" : "unreachable";
}

function sessionDetail(check: SessionProviderCheck | undefined, t: (key: string) => string): string {
  if (!check) return t("No session is running");
  if (check.reachable) return t("Reached the model through the gateway");
  return check.error ?? (check.status ? `HTTP ${check.status}` : t("The session could not reach the model"));
}

function DiagnosticsContent({
  snapshot,
  sessionCheck,
}: {
  snapshot: AIDiagnosticsSnapshot;
  sessionCheck: SessionProviderCheck | undefined;
}) {
  const { t, i18n } = useTranslation();
  const providerName = t(getProviderEntry(snapshot.provider.id)?.labelKey ?? snapshot.provider.id);
  const errors = groupDiagnosticErrors(snapshot.recentErrors);
  const relativeTime = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.resolvedLanguage ?? i18n.language, { numeric: "auto", style: "narrow" }),
    [i18n.language, i18n.resolvedLanguage],
  );
  const capabilities = [
    ["Sandboxed commands", snapshot.capabilities.sandbox],
    ["Container tools", snapshot.capabilities.containerTools],
    ["Workspace tools", snapshot.capabilities.workspaceTools],
    ["Execution targets", snapshot.capabilities.executionTargets],
  ] as const;
  return (
    <div className="AssistantDiagnosticsSections">
      <section className="AssistantDiagnosticPanel">
        <div className="AssistantDiagnosticProvider">
          <Icon icon={snapshot.provider.destination === "cloud" ? IconNames.CLOUD : IconNames.DESKTOP} size={24} />
          <div>
            <strong>{providerName}</strong>
            <span>{snapshot.provider.model}</span>
          </div>
          <StateTag state={snapshot.provider.reachability} />
        </div>
        {snapshot.provider.message ? <Callout intent={Intent.WARNING}>{snapshot.provider.message}</Callout> : null}
        <div className="AssistantDiagnosticMeta">
          <span>{t("Credential")}</span>
          <StateTag state={snapshot.provider.credential} />
          <span>{t("Models discovered")}</span>
          <strong>{snapshot.provider.modelCount ?? t("Unknown")}</strong>
          {/* The two questions kept apart on purpose: this app could reach the provider while the session cannot,
              which is exactly what a loopback endpoint does to a containerized agent. */}
          <span>{t("Reachable from the app")}</span>
          <StateTag state={snapshot.provider.reachability} />
          <span>{t("Reachable from the session")}</span>
          <StateTag state={sessionReachability(sessionCheck)} />
        </div>
        <div className="AssistantDiagnosticSessionDetail">{sessionDetail(sessionCheck, t)}</div>
      </section>

      <section className="AssistantDiagnosticPanel">
        <h5>{t("Host capabilities")}</h5>
        {capabilities.map(([label, available]) => (
          <CapabilityRow key={label} label={label} available={available} />
        ))}
      </section>

      <section className="AssistantDiagnosticPanel">
        <h5>{t("Security and extensions")}</h5>
        <div className="AssistantDiagnosticRow">
          <Icon icon={IconNames.SHIELD} />
          <span>{t("Credential encryption")}</span>
          <StateTag state={snapshot.security.encryption.degraded ? "degraded" : "ok"} />
        </div>
        <div className="AssistantDiagnosticRow">
          <Icon icon={IconNames.CONFIRM} />
          <span>{t("Permission cache")}</span>
          <StateTag state={snapshot.security.permissions} />
        </div>
        <div className="AssistantDiagnosticRow">
          <Icon icon={IconNames.LIGHTBULB} />
          <span>{t("Skills")}</span>
          <StateTag state={snapshot.extensions.skills.state} />
        </div>
        <div className="AssistantDiagnosticRow">
          <Icon icon={IconNames.APPLICATIONS} />
          <span>{t("MCP servers")}</span>
          <Tag minimal>{t("Not implemented")}</Tag>
        </div>
      </section>

      {errors.length ? (
        <section className="AssistantDiagnosticPanel AssistantDiagnosticErrors">
          <h5>
            <span>{t("Recent AI errors")}</span>
            <Tag minimal>{errors.length}</Tag>
          </h5>
          {errors.map(({ error, count }) => {
            const age = sessionRelativeAge(error.at);
            return (
              <details key={`${error.at}:${error.message}`} className="AssistantDiagnosticError">
                <summary>
                  <Icon icon={IconNames.ERROR} intent={Intent.DANGER} />
                  <span title={error.message}>{error.message}</span>
                  {count > 1 ? <Tag minimal>{`×${count}`}</Tag> : null}
                  <time dateTime={new Date(error.at).toISOString()}>{relativeTime.format(age.value, age.unit)}</time>
                  <Icon className="AssistantDiagnosticErrorChevron" icon={IconNames.CHEVRON_DOWN} />
                </summary>
                <div>
                  {error.context ? <code>{error.context}</code> : null}
                  <p>{error.message}</p>
                </div>
              </details>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

export function AssistantDiagnosticsDrawer({ providerId, onClose }: AssistantDiagnosticsDrawerProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<AIDiagnosticsSnapshot>();
  const [sessionCheck, setSessionCheck] = useState<SessionProviderCheck>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      // Both checks, every time: their answers are independent and a stale one next to a fresh one reads as agreement.
      const [hostSnapshot, session] = await Promise.all([
        window.AI.diagnostics(providerId),
        useCodingAgentStore.getState().checkSessionProvider(),
      ]);
      setSnapshot(hostSnapshot);
      setSessionCheck(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("AI diagnostics failed"));
    } finally {
      setLoading(false);
    }
  }, [providerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppDrawer
      className="AssistantDiagnosticsDrawer"
      icon={IconNames.PULSE}
      title={t("AI diagnostics")}
      size={DrawerSize.SMALL}
      onClose={onClose}
    >
      <div className={Classes.DRAWER_BODY} data-testid="assistant-diagnostics-drawer">
        <div className={Classes.DIALOG_BODY}>
          <div className="AssistantDiagnosticsToolbar">
            <span>{t("Live host and provider checks")}</span>
            <Button size="small" icon={IconNames.REFRESH} text={t("Check again")} loading={loading} onClick={load} />
          </div>
          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
          {loading && !snapshot ? (
            <div className="AssistantDiagnosticsLoading">
              <Spinner size={18} />
              <span>{t("Checking AI system…")}</span>
            </div>
          ) : snapshot ? (
            <DiagnosticsContent snapshot={snapshot} sessionCheck={sessionCheck} />
          ) : null}
        </div>
      </div>
    </AppDrawer>
  );
}

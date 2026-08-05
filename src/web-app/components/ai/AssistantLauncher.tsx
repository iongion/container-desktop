// The assistant's empty state IS its bootstrap. One surface where a working assistant is one click away, the user's
// own sessions sit beside it, and each row says what that session may actually do — instead of a modal form that has
// to be completed before anything happens.

import { Button, Icon, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import type { SessionLauncher } from "@/ai-system/core/sessionLaunchers";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";

// The engine this app favours, in the one place the launcher decides what to highlight.
const FAVOURED_ENGINE = "podman";

import "./AssistantLauncher.css";

export interface AssistantLauncherProps {
  rows: readonly SessionLauncher[];
  // The engine each connection runs, for the row's glyph — connections are how a session's containers are reached, so
  // a row says which engine it lands on.
  engineOf: (connectionId: string) => string | undefined;
  starting?: string;
  onLaunch: (row: SessionLauncher) => void;
  onConfigure: (row: SessionLauncher) => void;
  onForget: (row: SessionLauncher) => void;
  onCreate: () => void;
}

// The verb follows the state, because they mean different things to the user: continuing costs nothing, resuming
// starts containers that still hold the conversation, and starting builds them.
function actionLabel(row: SessionLauncher, t: (key: string) => string): string {
  if (row.action === "continue") return t("Continue");
  return row.action === "resume" ? t("Resume") : t("Start");
}

function stateLabel(row: SessionLauncher, t: (key: string) => string): string {
  if (row.state === "running") return t("running");
  return row.state === "stopped" ? t("stopped · keeps its conversation") : t("ready to start");
}

// What this session may reach, in the user's terms rather than the spec's. Stated positively where it can and
// negatively where it cannot, so the absence of a capability is as visible as its presence.
function capabilities(row: SessionLauncher, t: (key: string) => string): { label: string; off?: boolean }[] {
  return [
    ...(row.modelId ? [{ label: row.modelId }] : []),
    { label: t("reads & writes that folder") },
    row.egress ? { label: t("web access") } : { label: t("no web access"), off: true },
  ];
}

export const AssistantLauncher: React.FC<AssistantLauncherProps> = ({
  rows,
  engineOf,
  starting,
  onLaunch,
  onConfigure,
  onForget,
  onCreate,
}) => {
  const { t } = useTranslation();
  // Exactly one row reads as "the answer", and which one is asked EXPLICITLY rather than taken from the order: a
  // session already configured on another engine sorts ahead of the offered ones, so relying on position handed the
  // highlight to docker on a machine that has both. This app favours podman.
  const startable = rows.filter((row) => row.isDefault && row.state === "absent");
  const primary = (startable.find((row) => engineOf(row.connectionId) === FAVOURED_ENGINE) ?? startable[0])
    ?.connectionId;

  return (
    <div className="AssistantLauncher">
      <Icon icon={IconNames.CHAT} size={40} />
      <h2>{t("Your assistant is ready")}</h2>
      <p className="AssistantLauncherLead">
        {t("It runs in a container on your engine, and sees only the folder you point it at.")}
      </p>

      <ul className="AssistantLauncherList">
        {rows.map((row) => (
          <li
            key={`${row.connectionId}:${row.name}`}
            className="AssistantLauncherRow"
            data-primary={row.connectionId === primary ? "yes" : undefined}
          >
            <span className="AssistantLauncherState" data-state={row.state} title={stateLabel(row, t)} />
            <span className="AssistantLauncherMain">
              <span className="AssistantLauncherTitle">
                <strong>{row.name}</strong>
                <span className="AssistantLauncherBadge">{stateLabel(row, t)}</span>
              </span>
              <span className="AssistantLauncherWhere">
                <span
                  className="AssistantLauncherEngine"
                  data-engine-marker={engineOf(row.connectionId)}
                  aria-hidden="true"
                />
                <span>
                  {row.connectionId} · {row.workspacePath}
                </span>
              </span>
              <span className="AssistantLauncherCan">
                {capabilities(row, t).map((capability) => (
                  <span key={capability.label} data-off={capability.off ? "yes" : undefined}>
                    {capability.label}
                  </span>
                ))}
              </span>
            </span>
            <Button
              size="small"
              intent={row.action === "resume" ? Intent.NONE : Intent.PRIMARY}
              variant={row.action === "resume" ? "outlined" : "solid"}
              text={actionLabel(row, t)}
              loading={starting === row.connectionId}
              onClick={() => onLaunch(row)}
            />
            <Button
              size="small"
              icon={IconNames.COG}
              variant="minimal"
              title={t("Configure")}
              aria-label={t("Configure")}
              onClick={() => onConfigure(row)}
            />
            {row.isDefault ? null : (
              <ConfirmMenu
                tag={row.connectionId}
                title={t("Forget this session")}
                onConfirm={(_tag, confirmed) => {
                  if (confirmed) onForget(row);
                }}
              />
            )}
          </li>
        ))}
      </ul>

      <Button
        icon={IconNames.PLUS}
        variant="minimal"
        text={t("New session")}
        onClick={onCreate}
        disabled={!!starting}
      />
    </div>
  );
};

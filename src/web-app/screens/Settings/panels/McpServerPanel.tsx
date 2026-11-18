import { FormGroup, HTMLSelect, Icon, Intent, NumericInput, Switch } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { userConfiguration } from "@/container-client/config";
import {
  DEFAULT_MCP_PORT,
  MCP_SETTINGS_KEY,
  type McpServerMode,
  type McpSettings,
  normalizeMcpSettings,
} from "@/container-client/mcpSettings";
import { MCP_CHANNELS } from "@/platform/mcpIpc";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { CopyToClipboardInput } from "@/web-app/components/CopyToClipboardInput";
import { Notification } from "@/web-app/Notification";
import { applyMcpSettings, loadMcpServer, type McpServerDeps, type McpServerView } from "./mcpServerActions";

// The MCP server: AI clients (Claude Code, Cursor, VS Code, …) reach the app's engines through it, on this computer
// only. Its settings live under `mcp` in the settings file, outside the global settings; the native listener owns the
// socket and the token, which this panel shows once the server runs.
const DEPS: McpServerDeps = {
  invoke: (channel, payload) => window.MessageBus.invoke(channel, payload),
  saveSettings: (settings) => userConfiguration.setKey(MCP_SETTINGS_KEY, settings),
};

const STOPPED: McpServerView = { status: { running: false }, token: "" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const McpServerPanel: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<McpSettings>(() => normalizeMcpSettings(undefined));
  const [port, setPort] = useState(DEFAULT_MCP_PORT);
  const [view, setView] = useState<McpServerView>(STOPPED);
  const [busy, setBusy] = useState(false);
  const { status, token } = view;

  useEffect(() => {
    let active = true;
    Promise.all([userConfiguration.getKey(MCP_SETTINGS_KEY), loadMcpServer(DEPS)])
      .then(([stored, loaded]) => {
        if (!active) return;
        const normalized = normalizeMcpSettings(stored);
        setSettings(normalized);
        setPort(normalized.port);
        setView(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const apply = useCallback(
    async (patch: Partial<McpSettings>) => {
      const next = normalizeMcpSettings({ ...settings, ...patch });
      setSettings(next);
      setPort(next.port);
      setBusy(true);
      try {
        setView(await applyMcpSettings(next, DEPS));
      } catch (error) {
        Notification.show({ message: errorMessage(error), intent: Intent.DANGER });
      } finally {
        setBusy(false);
      }
    },
    [settings],
  );

  const commitPort = useCallback(() => {
    if (port !== settings.port) void apply({ port });
  }, [apply, port, settings.port]);

  const onRegenerate = useCallback(async (_tag: unknown, confirmed: boolean) => {
    if (!confirmed) return;
    try {
      const next = (await window.MessageBus.invoke(MCP_CHANNELS.regenerateToken)) as string;
      setView((current) => ({ ...current, token: next }));
    } catch (error) {
      Notification.show({ message: errorMessage(error), intent: Intent.DANGER });
    }
  }, []);

  const modeHint =
    settings.mode === "allow"
      ? t("AI clients can also start, stop, pause, restart and remove, and pull images.")
      : t("AI clients can list and inspect containers, images, networks and volumes, and read logs. Nothing changes.");

  return (
    <div className="AppSettingsForm" data-form="mcp">
      <FormGroup
        label={t("MCP server")}
        labelFor="mcpEnabled"
        helperText={t(
          "Lets AI clients such as Claude Code, Cursor or VS Code work with your engines, from this computer only.",
        )}
      >
        <div className="AppSettingsNetworkMode">
          <Switch
            id="mcpEnabled"
            checked={settings.enabled}
            disabled={busy}
            label={settings.enabled ? t("On") : t("Off")}
            onChange={(event) => void apply({ enabled: event.currentTarget.checked })}
          />
        </div>
      </FormGroup>

      <div className="AppSettingsNetworkEndpoint">
        <FormGroup className="McpField McpField--mode" label={t("Access")} labelFor="mcpMode" helperText={modeHint}>
          <HTMLSelect
            id="mcpMode"
            value={settings.mode}
            disabled={busy}
            fill
            onChange={(event) => void apply({ mode: event.currentTarget.value as McpServerMode })}
          >
            <option value="read-only">{t("Read-only")}</option>
            <option value="allow">{t("Allow changes")}</option>
          </HTMLSelect>
        </FormGroup>
        <FormGroup className="McpField McpField--port" label={t("Port")} labelFor="mcpPort">
          <NumericInput
            id="mcpPort"
            value={port}
            disabled={busy}
            fill
            allowNumericCharactersOnly
            min={1024}
            max={65535}
            stepSize={1}
            minorStepSize={1}
            onValueChange={(next) => setPort(Number.isFinite(next) ? next : settings.port)}
            onBlur={commitPort}
            onKeyDown={(event) => event.key === "Enter" && commitPort()}
          />
        </FormGroup>
      </div>

      <div className="AppSettingsMcpStatus" data-running={status.running ? "yes" : "no"}>
        {status.running ? (
          <>
            <Icon icon={IconNames.TICK_CIRCLE} intent={Intent.SUCCESS} />
            <span>{t("Listening on 127.0.0.1:{{port}}", { port: status.port })}</span>
          </>
        ) : status.error ? (
          <>
            <Icon icon={IconNames.ERROR} intent={Intent.DANGER} />
            <span>{status.error}</span>
          </>
        ) : (
          <>
            <Icon icon={IconNames.OFFLINE} />
            <span>{t("Off")}</span>
          </>
        )}
      </div>

      {status.running ? (
        <div className="AppSettingsNetworkCredentials">
          <FormGroup className="McpField McpField--url" label={t("Endpoint")}>
            <CopyToClipboardInput className="McpEndpoint" value={status.url ?? ""} />
          </FormGroup>
          <FormGroup className="McpField McpField--token" label={t("Token")}>
            <div className="AppSettingsMcpToken">
              <CopyToClipboardInput className="McpToken" value={token} />
              <ConfirmMenu
                title={t("Clients using the current token stop working until they get the new one")}
                actionText={t("Regenerate token")}
                actionIcon={IconNames.REFRESH}
                onConfirm={onRegenerate}
              />
            </div>
          </FormGroup>
        </div>
      ) : null}
    </div>
  );
};

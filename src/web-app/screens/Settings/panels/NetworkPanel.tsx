import { Button, FormGroup, HTMLSelect, InputGroup, Intent, NumericInput, Switch, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import {
  normalizeProxyConfig,
  type ProxyConfig,
  type ProxyMode,
  type ProxyProtocol,
  validateProxy,
} from "@/container-client/proxy";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { saveProxyAfterReachabilityTest } from "./networkProxyActions";

export const NetworkPanel: React.FC = () => {
  const { t } = useTranslation();
  const userSettings = useAppStore((state) => state.userSettings);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const persisted = useMemo(() => normalizeProxyConfig(userSettings.proxy), [userSettings.proxy]);
  const [draft, setDraft] = useState<ProxyConfig>(persisted);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const manual = draft.mode === "manual";
  const validation = validateProxy(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted);

  useEffect(() => {
    setDraft(persisted);
  }, [persisted]);

  const updateDraft = useCallback(<K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const saveProxy = useCallback(
    async (next: ProxyConfig) => {
      try {
        setSaving(true);
        const result = await saveProxyAfterReachabilityTest(next, {
          testProxyConnectivity: (proxy) => Application.getInstance().testProxyConnectivity(proxy),
          setGlobalUserSettings,
        });
        if (result.saved) {
          setDraft(result.proxy);
          Notification.show({ message: t("Proxy settings saved"), intent: Intent.SUCCESS });
        } else if (result.reason === "invalid") {
          Notification.show({
            message: t("Proxy host and port are required."),
            intent: Intent.DANGER,
          });
        } else {
          Notification.show({
            message: result.test.error || t("Connection failed."),
            intent: Intent.DANGER,
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [setGlobalUserSettings, t],
  );

  const setMode = useCallback(
    (mode: ProxyMode) => {
      const next =
        mode === "disabled" ? normalizeProxyConfig({ mode: "disabled" }) : normalizeProxyConfig({ ...draft, mode });
      setDraft(next);
    },
    [draft],
  );

  const onProtocolChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => updateDraft("protocol", event.currentTarget.value as ProxyProtocol),
    [updateDraft],
  );
  const onHostChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => updateDraft("host", event.currentTarget.value),
    [updateDraft],
  );
  const onPortChange = useCallback(
    (value: number) => updateDraft("port", Number.isFinite(value) ? value : 0),
    [updateDraft],
  );
  const onUsernameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => updateDraft("username", event.currentTarget.value),
    [updateDraft],
  );
  const onPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => updateDraft("password", event.currentTarget.value),
    [updateDraft],
  );
  const onBypassChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => updateDraft("bypass", event.currentTarget.value.split(/\n/)),
    [updateDraft],
  );
  const onSave = useCallback(() => saveProxy(normalizeProxyConfig(draft)), [draft, saveProxy]);
  const onTest = useCallback(async () => {
    const next = normalizeProxyConfig(draft);
    const validated = validateProxy(next);
    if (!validated.ok) {
      Notification.show({ message: t("Proxy host and port are required."), intent: Intent.DANGER });
      return;
    }
    setTesting(true);
    try {
      const result = await Application.getInstance().testProxyConnectivity(next);
      if (result.ok) {
        Notification.show({
          message: t("Connection reachable"),
          intent: Intent.SUCCESS,
        });
      } else {
        Notification.show({
          message: result.error || t("Connection failed."),
          intent: Intent.DANGER,
        });
      }
    } finally {
      setTesting(false);
    }
  }, [draft, t]);

  return (
    <div className="AppSettingsForm" data-form="network">
      <FormGroup label={t("Proxy")} labelFor="proxyMode">
        <div className="AppSettingsNetworkMode">
          <Switch
            id="proxyMode"
            checked={manual}
            label={manual ? t("Manual") : t("Disabled")}
            onChange={(event) => setMode(event.currentTarget.checked ? "manual" : "disabled")}
          />
        </div>
      </FormGroup>

      <div className="AppSettingsNetworkEndpoint">
        <FormGroup label={t("Protocol")} labelFor="proxyProtocol">
          <HTMLSelect id="proxyProtocol" value={draft.protocol} disabled={!manual} onChange={onProtocolChange}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </HTMLSelect>
        </FormGroup>
        <FormGroup label={t("Host")} labelFor="proxyHost">
          <InputGroup id="proxyHost" value={draft.host} disabled={!manual} fill onChange={onHostChange} />
        </FormGroup>
        <FormGroup label={t("Port")} labelFor="proxyPort">
          <NumericInput
            id="proxyPort"
            value={draft.port || ""}
            disabled={!manual}
            allowNumericCharactersOnly
            min={0}
            max={65535}
            stepSize={1}
            minorStepSize={1}
            onValueChange={onPortChange}
          />
        </FormGroup>
      </div>

      <div className="AppSettingsNetworkCredentials">
        <FormGroup label={t("Username")} labelFor="proxyUsername">
          <InputGroup id="proxyUsername" value={draft.username} disabled={!manual} fill onChange={onUsernameChange} />
        </FormGroup>
        <FormGroup label={t("Password")} labelFor="proxyPassword">
          <InputGroup
            id="proxyPassword"
            type="password"
            value={draft.password}
            disabled={!manual}
            fill
            onChange={onPasswordChange}
          />
        </FormGroup>
      </div>

      <FormGroup label={t("Bypass hosts")} labelFor="proxyBypass">
        <TextArea id="proxyBypass" value={draft.bypass.join("\n")} disabled={!manual} fill onChange={onBypassChange} />
      </FormGroup>

      <div className="AppSettingsNetworkActions">
        <Button
          icon={IconNames.FLOPPY_DISK}
          text={t("Save")}
          intent={Intent.PRIMARY}
          loading={saving}
          disabled={!dirty || !validation.ok || testing}
          onClick={onSave}
        />
        <Button
          icon={IconNames.GLOBE_NETWORK}
          text={t("Test connection")}
          loading={testing}
          disabled={!manual || saving}
          onClick={onTest}
        />
      </div>
    </div>
  );
};

import { Button, FormGroup, Intent, Switch } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { normalizeProxyConfig, type ProxyConfig, type ProxyMode, validateProxy } from "@/container-client/proxy";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { saveProxyAfterReachabilityTest } from "./networkProxyActions";
import { ProxyConfigFields } from "./ProxyConfigFields";

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

      <ProxyConfigFields value={draft} onChange={setDraft} disabled={!manual} />

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

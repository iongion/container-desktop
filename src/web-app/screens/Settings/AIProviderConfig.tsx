// Settings → AI Assistant = PROVIDER CONNECTION CONFIG. Two columns, one row: LEFT a provider
// chooser (the SAME shared ProviderSourceList the chat popover uses, but select-to-configure — no model
// drill), RIGHT the connection form for the selected provider: endpoint + auth scheme (None / Bearer /
// Basic / Custom header) + the matching credential fields, plus a typed model for llama.cpp. This screen
// configures HOW to connect; MODEL SELECTION lives in the chatbox. Selecting a provider here only chooses
// what to configure — it never changes the default. Secrets are written to the OS keychain (window.AI),
// never read back.
import { Button, ButtonGroup, FormGroup, HTMLSelect, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type AIAuthScheme,
  type AIAuthSettings,
  authSchemesFor,
  DEFAULT_AI_SETTINGS,
  getProviderEntry,
  isOffDeviceURL,
  schemeNeedsSecret,
} from "@/ai-system/core";
import type { AIProviderSettings, AISettings } from "@/env/Types";
import { ProviderSourceList } from "@/web-app/components/ai/ProviderSourceList";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

import "./AIProviderConfig.css";

export interface AIProviderConfigProps {
  /** Consent to store secrets without OS encryption (only meaningful in a degraded environment). */
  allowDegraded: boolean;
}

export const AIProviderConfig: React.FC<AIProviderConfigProps> = ({ allowDegraded }) => {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const bridge: IAI | undefined = typeof window !== "undefined" ? window.AI : undefined;

  // The provider being CONFIGURED (chosen in the left list). Defaults to the saved default; picking a row
  // here only changes what we configure — it never touches ai.defaultProvider.
  const [configId, setConfigId] = useState<string>(ai.defaultProvider);
  const entry = getProviderEntry(configId);
  const providerCfg: AIProviderSettings = ai.providers?.[configId] ?? { model: "" };
  const scheme: AIAuthScheme = providerCfg.auth?.scheme ?? entry?.defaultAuthScheme ?? "none";
  const auth: AIAuthSettings = providerCfg.auth ?? { scheme };

  const [keyPresent, setKeyPresent] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [revealSecret, setRevealSecret] = useState(false);
  const [testing, setTesting] = useState(false);

  const patchProviderConfig = useCallback(
    (id: string, patch: Partial<AIProviderSettings>) => {
      const current = useAppStore.getState().userSettings.ai ?? DEFAULT_AI_SETTINGS;
      void setGlobalUserSettings({
        ai: { ...current, providers: { ...current.providers, [id]: { ...current.providers?.[id], ...patch } } },
      });
    },
    [setGlobalUserSettings],
  );

  // Reflect whether THIS provider+scheme has a stored secret; reset the draft when the source/scheme changes.
  useEffect(() => {
    setKeyDraft("");
    setRevealSecret(false);
    if (!bridge || !schemeNeedsSecret(scheme)) {
      setKeyPresent(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const has = await bridge.hasKey(configId);
        if (!cancelled) {
          setKeyPresent(has);
        }
      } catch {
        if (!cancelled) {
          setKeyPresent(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, scheme, configId]);

  // Switching the scheme drops any stored secret AND the scheme-specific fields (username/headerName), so a
  // bearer token is never silently reused as a basic password.
  const onSchemeChange = useCallback(
    async (next: AIAuthScheme) => {
      patchProviderConfig(configId, { auth: { scheme: next } });
      setKeyDraft("");
      setKeyPresent(false);
      if (bridge) {
        try {
          await bridge.clearKey(configId);
        } catch {
          /* nothing stored yet — fine */
        }
      }
    },
    [bridge, configId, patchProviderConfig],
  );

  // Save the typed secret; an EMPTY save REMOVES the stored secret — no separate delete button: the trailing
  // ✕ clears the field, then Save commits the removal. The secret is never read back into the field.
  const onSaveKey = useCallback(async () => {
    if (!bridge) {
      return;
    }
    try {
      if (keyDraft.trim()) {
        await bridge.setKey(configId, keyDraft, { allowDegraded });
        setKeyPresent(true);
        Notification.show({ message: t("Credential saved"), intent: Intent.SUCCESS });
      } else {
        await bridge.clearKey(configId);
        setKeyPresent(false);
        Notification.show({ message: t("Credential removed"), intent: Intent.SUCCESS });
      }
      setKeyDraft("");
      setRevealSecret(false);
    } catch (error: any) {
      Notification.show({ message: error?.message ?? t("Unable to update the credential"), intent: Intent.DANGER });
    }
  }, [bridge, configId, keyDraft, allowDegraded, t]);

  // Probe connectivity for ANY provider by listing its models against the configured endpoint + auth — a
  // real round-trip that reuses the same gate/auth as chat (uses the SAVED secret, so Save before Test).
  const onTest = useCallback(async () => {
    if (!bridge) {
      return;
    }
    setTesting(true);
    try {
      const { models } = await bridge.listModels(configId);
      Notification.show({
        message: t("aiModelsReachable", { count: models.length, context: `${models.length}` }),
        intent: Intent.SUCCESS,
      });
    } catch (error: any) {
      Notification.show({ message: error?.message ?? t("Connection failed."), intent: Intent.DANGER });
    } finally {
      setTesting(false);
    }
  }, [bridge, configId, t]);

  const remoteLocalUrl = !entry?.cloud && !!providerCfg.baseURL && isOffDeviceURL(providerCfg.baseURL);
  const secretLabel = scheme === "basic" ? t("Password") : scheme === "header" ? t("Header value") : t("API key");
  const schemeLabels: Record<AIAuthScheme, string> = {
    none: t("None"),
    bearer: t("API key (Bearer token)"),
    basic: t("Basic (username + password)"),
    header: t("Custom header"),
  };
  // Only the schemes the provider declares it supports (clouds → API key; locals → none/API key). Keep the
  // current scheme visible even if an older config sits outside the offered set.
  const offeredSchemes = authSchemesFor(entry);
  const schemeOptions = offeredSchemes.includes(scheme) ? offeredSchemes : [scheme, ...offeredSchemes];

  return (
    <div className="AIProviderConfig">
      <div className="AIProviderConfigSources">
        <ProviderSourceList activeId={configId} onSelect={(e) => setConfigId(e.id)} />
      </div>

      <div className="AIProviderConfigForm" data-provider={configId}>
        <FormGroup
          label={t("Base URL")}
          labelFor="aiProviderBaseURL"
          helperText={
            remoteLocalUrl
              ? t("This URL is NOT loopback — it is treated as off-device.")
              : entry?.cloud
                ? t("The provider's API endpoint. Change it only for a self-hosted or proxy gateway.")
                : t("A loopback URL keeps everything on this machine.")
          }
          intent={remoteLocalUrl ? Intent.WARNING : Intent.NONE}
        >
          <InputGroup
            id="aiProviderBaseURL"
            fill
            value={providerCfg.baseURL ?? ""}
            intent={remoteLocalUrl ? Intent.WARNING : Intent.NONE}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              patchProviderConfig(configId, { baseURL: e.currentTarget.value })
            }
          />
        </FormGroup>

        <FormGroup
          label={t("Authentication")}
          labelFor="aiProviderAuthScheme"
          helperText={t("Changing the scheme clears any stored secret.")}
        >
          <HTMLSelect
            id="aiProviderAuthScheme"
            fill
            value={scheme}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              void onSchemeChange(e.currentTarget.value as AIAuthScheme)
            }
          >
            {schemeOptions.map((s) => (
              <option key={s} value={s}>
                {schemeLabels[s]}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>

        {scheme === "basic" ? (
          <FormGroup label={t("Username")} labelFor="aiProviderUsername">
            <InputGroup
              id="aiProviderUsername"
              fill
              value={auth.username ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                patchProviderConfig(configId, { auth: { ...auth, username: e.currentTarget.value } })
              }
            />
          </FormGroup>
        ) : null}

        {scheme === "header" ? (
          <FormGroup label={t("Header name")} labelFor="aiProviderHeaderName">
            <InputGroup
              id="aiProviderHeaderName"
              fill
              placeholder="X-API-Key"
              value={auth.headerName ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                patchProviderConfig(configId, { auth: { ...auth, headerName: e.currentTarget.value } })
              }
            />
          </FormGroup>
        ) : null}

        {schemeNeedsSecret(scheme) ? (
          <FormGroup
            label={secretLabel}
            labelFor="aiProviderSecret"
            helperText={
              keyPresent
                ? t("A secret is stored (encrypted). Save with an empty field to remove it.")
                : t("No secret stored yet.")
            }
          >
            <InputGroup
              id="aiProviderSecret"
              type={revealSecret ? "text" : "password"}
              fill
              placeholder={t("Paste credential")}
              value={keyDraft}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyDraft(e.currentTarget.value)}
              rightElement={
                keyDraft ? (
                  <ButtonGroup variant="minimal">
                    <Button
                      size="small"
                      icon={revealSecret ? IconNames.EYE_OFF : IconNames.EYE_OPEN}
                      title={revealSecret ? t("Hide") : t("Show")}
                      aria-label={revealSecret ? t("Hide secret") : t("Show secret")}
                      onClick={() => setRevealSecret((v) => !v)}
                    />
                    <Button
                      size="small"
                      icon={IconNames.CROSS}
                      title={t("Clear")}
                      aria-label={t("Clear")}
                      onClick={() => {
                        setKeyDraft("");
                        setRevealSecret(false);
                      }}
                    />
                  </ButtonGroup>
                ) : undefined
              }
            />
          </FormGroup>
        ) : null}

        {entry?.discovery === "single" ? (
          <FormGroup
            label={t("Model")}
            labelFor="aiProviderModel"
            helperText={t("This server binds one model at launch (-m); enter its id.")}
          >
            <InputGroup
              id="aiProviderModel"
              fill
              value={providerCfg.model ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                patchProviderConfig(configId, { model: e.currentTarget.value })
              }
            />
          </FormGroup>
        ) : null}

        {/* Form actions on their OWN row (the sensitive field above stands alone): probe connectivity for
            every provider, and — when a secret is needed — save or remove it. */}
        <div className="AIProviderConfigActions">
          {schemeNeedsSecret(scheme) ? (
            <Button
              icon={IconNames.FLOPPY_DISK}
              text={t("Save")}
              intent={Intent.PRIMARY}
              disabled={!bridge || (!keyDraft.trim() && !keyPresent)}
              onClick={onSaveKey}
            />
          ) : null}
          <Button
            icon={IconNames.GLOBE_NETWORK}
            text={t("Test connection")}
            loading={testing}
            disabled={!bridge}
            onClick={onTest}
          />
        </div>
      </div>
    </div>
  );
};

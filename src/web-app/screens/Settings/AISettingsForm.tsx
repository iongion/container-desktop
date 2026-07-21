import { Callout, Checkbox, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { createLogger } from "@/logger";
import { useAppStore } from "@/web-app/stores/appStore";
import { AIPermissions } from "./AIPermissions";
import { AIProviderConfig } from "./AIProviderConfig";

const logger = createLogger("web.settings");

// Local-first AI settings. AI is always on — there is no master switch or cloud/local-only
// checkbox: the privacy callout leads, then the provider CONNECTION configurator (AIProviderConfig) — a
// provider chooser + that provider's endpoint and auth. MODEL selection lives in the chat composer, not
// here. Saving a provider connection chooses its destination. Secrets live in main; this screen only writes them
// (never reads them back). The degraded-encryption consent is about secret-at-rest encryption.
type EncryptionStatus = { available: boolean; backend?: string; degraded: boolean };

export const AISettingsForm: React.FC = () => {
  const { t } = useTranslation();
  const bridge: IAI | undefined = typeof window !== "undefined" ? window.AI : undefined;
  const ai = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);

  const [encryption, setEncryption] = useState<EncryptionStatus | null>(null);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [allowDegraded, setAllowDegraded] = useState(false);
  // Edited locally, committed on blur so we don't persist+sync on every keystroke.
  const [workspaceRoot, setWorkspaceRoot] = useState(ai.workspaceRoot ?? "");
  useEffect(() => {
    setWorkspaceRoot(ai.workspaceRoot ?? "");
  }, [ai.workspaceRoot]);

  const commitWorkspaceRoot = (): void => {
    const value = workspaceRoot.trim();
    if (value !== (ai.workspaceRoot ?? "")) {
      void setGlobalUserSettings({ ai: { ...ai, workspaceRoot: value || undefined } });
    }
  };

  // Pull the live encryption health so the degraded-security consent only appears when there is no OS keychain.
  useEffect(() => {
    if (!bridge) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await bridge.status();
        if (!cancelled) {
          setEncryption(status.encryption);
          setWebSearchAvailable(status.webSearchAvailable);
        }
      } catch (error: any) {
        logger.error("Unable to read AI status", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  return (
    <div className="AppSettingsForm" data-form="ai">
      <Callout intent={Intent.PRIMARY} icon={IconNames.INFO_SIGN} className="AppSettingsAIPrivacy">
        <p>
          {t(
            "It is recommended to use LM Studio or llama.cpp server on this machine, cloud providers are not secure and never will be!",
          )}
        </p>
      </Callout>

      <AIProviderConfig allowDegraded={allowDegraded} />

      <Checkbox
        id="aiWebSearch"
        label={t("Enable public web search for the assistant")}
        checked={ai.webSearch}
        disabled={!webSearchAvailable}
        onChange={(event) =>
          void setGlobalUserSettings({ ai: { ...ai, webSearch: event.currentTarget.checked && webSearchAvailable } })
        }
      />

      {!webSearchAvailable ? (
        <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN}>
          {t("Secure public web search is unavailable on this application runtime.")}
        </Callout>
      ) : null}

      <FormGroup
        label={t("Workspace folder")}
        labelFor="aiWorkspaceRoot"
        helperText={t(
          "Absolute path the assistant's file tools may read, edit, and run in. Access is confined to this folder. Leave empty to disable workspace tools.",
        )}
      >
        <InputGroup
          id="aiWorkspaceRoot"
          leftIcon={IconNames.FOLDER_CLOSE}
          placeholder={t("/path/to/your/project")}
          value={workspaceRoot}
          onChange={(event) => setWorkspaceRoot(event.currentTarget.value)}
          onBlur={commitWorkspaceRoot}
        />
      </FormGroup>

      <AIPermissions webSearchEnabled={ai.webSearch} webSearchAvailable={webSearchAvailable} />

      {encryption?.degraded ? (
        <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN} className="AppSettingsAIDegraded">
          <p>
            {t(
              "Degraded security: no OS keychain is available ({{backend}}), so API keys would be stored without OS encryption.",
              { backend: encryption.backend ?? "basic_text" },
            )}
          </p>
          <Checkbox
            id="aiAllowDegraded"
            label={t("Store cloud keys anyway")}
            checked={allowDegraded}
            onChange={(e) => setAllowDegraded(!!e.currentTarget.checked)}
          />
        </Callout>
      ) : null}
    </div>
  );
};

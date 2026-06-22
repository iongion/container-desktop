import { Callout, Checkbox, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AIPermissions } from "./AIPermissions";
import { AIProviderConfig } from "./AIProviderConfig";

// Local-first AI settings. AI is always on — there is no master switch or cloud/local-only
// checkbox: the privacy callout leads, then the provider CONNECTION configurator (AIProviderConfig) — a
// provider chooser + that provider's endpoint and auth. MODEL selection lives in the chat composer, not
// here. Cloud consent IS saving a credential. Secrets live in main; this screen only writes them (never
// reads them back). The degraded-encryption consent stays here (about secret-at-rest encryption, not egress).
type EncryptionStatus = { available: boolean; backend?: string; degraded: boolean };

export const AISettingsForm: React.FC = () => {
  const { t } = useTranslation();
  const bridge: IAI | undefined = typeof window !== "undefined" ? window.AI : undefined;

  const [encryption, setEncryption] = useState<EncryptionStatus | null>(null);
  const [allowDegraded, setAllowDegraded] = useState(false);

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
        }
      } catch (error: any) {
        console.error("Unable to read AI status", error);
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

      <AIPermissions />

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

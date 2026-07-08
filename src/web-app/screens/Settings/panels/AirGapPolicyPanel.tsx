import { Button, Icon, Switch } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";

import { t } from "@/i18n";
// App-wide supply-chain policy — reuses the Registries & Trust design language (cards / switch rows /
// allow rows / diagnosis stripe) so the two surfaces read as one system.
import "../../Registry/RegistriesTrust.css";

// Air-gap & policy — APP-WIDE supply-chain policy, in global Settings (not per-connection) because it governs
// the whole workspace: offline pull gate, run-only-signed (cosign), and the allowed-registry allowlist. A
// design preview until the policy backend wires in (handover Step 5); toggles are local-only for now.
const ALLOWED_REGISTRIES: { name: string; note: string; allowed: boolean }[] = [
  { name: "registry.corp.local:5000", note: t("mirror · internal"), allowed: true },
  { name: "quay.io", note: t("base images"), allowed: true },
  { name: "docker.io", note: t("public"), allowed: false },
];

export const AirGapPolicyPanel: React.FC = () => {
  const [airGap, setAirGap] = useState(true);
  const [signedOnly, setSignedOnly] = useState(false);
  const allowedCount = ALLOWED_REGISTRIES.filter((r) => r.allowed).length;

  return (
    <div className="TrustPanel">
      <div className="TrustCard">
        <div className="TrustCardHead">
          <h5>{t("Offline & pull policy")}</h5>
        </div>
        <p className="TrustNote">{t("Preview — policy enforcement wires in a later release.")}</p>
        <div className="TrustSwitchRow">
          <Switch size="large" checked={airGap} onChange={(e) => setAirGap(e.currentTarget.checked)} />
          <div className="TrustSwitchText">
            <div className="t">{t("Air-gap mode")}</div>
            <div className="d">
              {t(
                "Block every image pull except from the allowed registries below. Stops surprise reaches to docker.io / quay.io during installs and builds.",
              )}
            </div>
          </div>
        </div>
        <div className="TrustSwitchRow">
          <Switch size="large" checked={signedOnly} onChange={(e) => setSignedOnly(e.currentTarget.checked)} />
          <div className="TrustSwitchText">
            <div className="t">{t("Only run signed images")}</div>
            <div className="d">
              {t(
                "Refuse to start containers whose image isn't signed by an allowed identity (cosign / sigstore), checked against your configured signers.",
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="TrustCard">
        <div className="TrustCardHead">
          <h5>{t("Allowed registries")}</h5>
          <Button
            variant="minimal"
            size="small"
            icon={IconNames.PLUS}
            text={t("Add")}
            disabled
            title={t("Wired next")}
          />
        </div>
        <p className="TrustNote">{t("While air-gap mode is on, pulls resolve only to these.")}</p>
        {ALLOWED_REGISTRIES.map((registry) => (
          <div key={registry.name} className={`TrustAllowRow${registry.allowed ? "" : " is-blocked"}`}>
            <Icon icon={IconNames.CUBE} size={14} />
            <span className="an">{registry.name}</span>
            <span className="as">{t(registry.note)}</span>
            <span className={`TrustPill TrustPill--${registry.allowed ? "ok" : "err"}`}>
              {registry.allowed ? t("allowed") : t("blocked")}
            </span>
          </div>
        ))}
      </div>

      {airGap ? (
        <div className="TrustDiagnosis TrustDiagnosis--ok">
          <div className="TrustDiagnosisIcon">
            <Icon icon={IconNames.TICK_CIRCLE} />
          </div>
          <div className="TrustDiagnosisBody">
            <h5>{t("Air-gap active — {{count}} registries allowed", { count: allowedCount })}</h5>
            <p>
              {t(
                "Pulls are restricted to the allowed registries. A pull of a blocked image is refused with a clear reason instead of hanging on a blocked network.",
              )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

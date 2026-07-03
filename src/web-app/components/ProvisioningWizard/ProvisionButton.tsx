import { Button } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

// Persistent entry point in the header: opens the full-screen wizard anytime.
export function ProvisionButton() {
  const { t } = useTranslation();
  const openWizard = useProvisioningStore((s) => s.openWizard);
  return (
    <Button
      className="AppHeaderActionButton PWizProvisionButton"
      data-testid="provision-button"
      icon={IconNames.CUBE_ADD}
      title={t("Provision")}
      aria-label={t("Provision")}
      onClick={() => openWizard("manual")}
    />
  );
}

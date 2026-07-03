import { useEffect } from "react";

import { AppBootstrapPhase } from "@/web-app/App.types";
import { useAppStore } from "@/web-app/stores/appStore";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

import { ProvisioningWizardView } from "./ProvisioningWizardView";

// Mount point + first-run gate for the full-screen wizard. Lives OUTSIDE the bootstrap critical path:
// it only reads appStore.phase and never blocks startApplication.
export function ProvisioningWizardHost() {
  const isOpen = useProvisioningStore((s) => s.isOpen);
  const maybeShowAtStartup = useProvisioningStore((s) => s.maybeShowAtStartup);
  const phase = useAppStore((s) => s.phase);
  const wizard = useAppStore((s) => s.userSettings.wizard);
  const setGlobalUserSettings = useAppStore((s) => s.setGlobalUserSettings);

  // Auto-open the wizard once, on the first launch after install. The instant it opens we persist a first-run
  // marker (merged into the existing wizard settings) so it never auto-opens again — even on force-quit;
  // afterwards it's opened manually from the header Provision button. The gate ignores an unloaded (undefined)
  // wizard, so this can't fire during the pre-settings-load window that caused the every-boot behaviour.
  useEffect(() => {
    if (phase === AppBootstrapPhase.READY && maybeShowAtStartup(wizard, true)) {
      void setGlobalUserSettings({
        wizard: { ...(wizard ?? { skipAtStartup: false }), firstRunHandledAt: new Date().toISOString() },
      });
    }
  }, [phase, wizard, maybeShowAtStartup, setGlobalUserSettings]);

  return isOpen ? <ProvisioningWizardView /> : null;
}

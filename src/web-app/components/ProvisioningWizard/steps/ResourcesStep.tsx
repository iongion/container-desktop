import { Callout, NumericInput } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { defaultResources, needsResources } from "@/container-provisioning/targetDefaults";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

// Step 3 — size the VM for the create rungs (Lima / WSL). Hidden (with a note) for native installs and
// reuse, where there's nothing to allocate.
export function ResourcesStep() {
  const { t } = useTranslation();
  const target = useProvisioningStore((s) => s.target);
  const patchTarget = useProvisioningStore((s) => s.patchTarget);

  // Seed defaults once when this step applies and none are set yet.
  useEffect(() => {
    if (target && needsResources(target.strategy) && !target.resources) {
      patchTarget({ resources: defaultResources() });
    }
  }, [target, patchTarget]);

  if (!target) {
    return null;
  }

  if (!needsResources(target.strategy)) {
    return (
      <Callout intent="none" icon={IconNames.INFO_SIGN}>
        {target.strategy === "reuse.installed"
          ? t("You're reusing an existing setup — there's no virtual machine to size.")
          : t("This engine runs natively on your machine — there's no virtual machine to size.")}
      </Callout>
    );
  }

  const resources = target.resources ?? defaultResources();
  const set = (key: "cpus" | "ramSize" | "diskSize") => (value: number) =>
    patchTarget({ resources: { ...resources, [key]: value } });

  return (
    <div className="PWizResources">
      <label className="PWizField" htmlFor="pwiz-cpus">
        <span className="PWizFieldLabel">{t("CPUs")}</span>
        <NumericInput id="pwiz-cpus" min={1} max={16} value={resources.cpus} onValueChange={set("cpus")} />
      </label>
      <label className="PWizField" htmlFor="pwiz-ram">
        <span className="PWizFieldLabel">{t("Memory (MB)")}</span>
        <NumericInput
          id="pwiz-ram"
          min={1024}
          max={65536}
          stepSize={1024}
          value={resources.ramSize}
          onValueChange={set("ramSize")}
        />
      </label>
      <label className="PWizField" htmlFor="pwiz-disk">
        <span className="PWizFieldLabel">{t("Disk (GB)")}</span>
        <NumericInput
          id="pwiz-disk"
          min={10}
          max={512}
          stepSize={10}
          value={resources.diskSize}
          onValueChange={set("diskSize")}
        />
      </label>
    </div>
  );
}

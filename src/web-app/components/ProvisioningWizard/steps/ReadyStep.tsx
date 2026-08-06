import { Callout, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { readinessFromRun } from "@/container-provisioning/runView";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

export function ReadyStep() {
  const { t } = useTranslation();
  const plan = useProvisioningStore((s) => s.plan);
  const run = useProvisioningStore((s) => s.run);
  const setupAssistant = useProvisioningStore((s) => s.setupAssistant);

  if (!plan || !run || run.overall === "idle") {
    return <p className="PWizSub">{t("Run the setup to see the readiness checklist.")}</p>;
  }

  const report = readinessFromRun(plan, run);
  return (
    <div className="PWizReady">
      <Callout
        intent={report.ready ? "success" : "warning"}
        icon={report.ready ? IconNames.TICK_CIRCLE : IconNames.WARNING_SIGN}
        title={report.ready ? t("You're ready to run containers") : t("Setup didn't finish")}
      >
        {report.ready
          ? t("Your engine is set up with shared folders and permissions that just work.")
          : t("Something went wrong during setup — review the step below and try again.")}
      </Callout>
      {report.ready && setupAssistant ? (
        <Callout intent="primary" icon={IconNames.CHAT} compact>
          {t("Your assistant is ready")}
        </Callout>
      ) : null}
      <ul className="PWizChecklist">
        {report.items.map((item) => (
          <li key={item.key} className={`PWizCheck ${item.ok ? "is-ok" : "is-bad"}`}>
            <Icon
              icon={item.ok ? IconNames.TICK : IconNames.CROSS}
              color={item.ok ? "var(--app-intent-success-rest)" : "var(--app-intent-danger-rest, #db3737)"}
            />
            <span className="PWizCheckLabel">{t(item.label)}</span>
            <span className="PWizCheckDetail">{item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

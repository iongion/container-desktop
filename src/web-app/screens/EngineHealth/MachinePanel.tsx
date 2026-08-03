import prettyBytes from "pretty-bytes";
import { useTranslation } from "react-i18next";

import type { PodmanMachine } from "@/container-client/types/machine";
import type { SystemDf } from "@/container-client/types/system";
import { buildMachineSummary } from "@/web-app/screens/Machine/inspectSummary";
import { useMachinesList } from "@/web-app/screens/Machine/queries";

// Machine panel — a VM-backed connection's managed machine (Podman). Shows the machine's allocated resources
// (reusing the tested buildMachineSummary) + running state + image disk usage from /system/df. Only rendered
// for transport "vm" with the machines capability; graceful "no managed machine" otherwise.
export function MachinePanel({ connectionId, scope, df }: { connectionId: string; scope?: string; df?: SystemDf }) {
  const { t } = useTranslation();
  const machines = (useMachinesList(connectionId).data ?? []) as PodmanMachine[];
  const machine = machines.find((item) => item.Name === scope) ?? machines[0];
  const running = machine?.Running === true;
  const rows = machine
    ? buildMachineSummary(machine).filter((row) => ["name", "cpus", "memory", "disk"].includes(row.key))
    : [];

  return (
    <div className="subCard">
      <div className="CardHead">
        <h5>{t("Machine")}</h5>
        {machine ? (
          <span className={`statePill ${running ? "running" : "remote"}`}>{running ? t("Running") : t("Stopped")}</span>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <div className="kv">
          {rows.map((row) => (
            <span key={row.key}>
              {row.label} <b>{row.value}</b>
            </span>
          ))}
        </div>
      ) : (
        <div className="muted">{t("No managed machine.")}</div>
      )}
      {df && df.imagesSize > 0 ? (
        <div className="kv">
          <span>
            {t("Disk image")} <b>{prettyBytes(df.imagesSize)}</b>
            {df.imagesReclaimable > 0 ? (
              <span className="muted">
                {" · "}
                {prettyBytes(df.imagesReclaimable)} {t("reclaimable")}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

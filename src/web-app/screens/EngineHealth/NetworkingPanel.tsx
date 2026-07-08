import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useMergedResources } from "@/web-app/hooks/useMergedResources";

import { findSubnetOverlaps } from "./subnets";

// Networking panel — the connection's custom networks with client-side subnet-overlap detection (the mockup's
// headline). Live DNS/egress probes are renderer-privileged (deferred), so this shows only what's honestly
// available: the networks table + overlap flags. The overlap becomes an aggregated Diagnosis in issues.ts.
export function NetworkingPanel({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation();
  const allNetworks = useMergedResources("networks");
  const networks = useMemo(
    () => allNetworks.filter((network) => network.connectionId === connectionId),
    [allNetworks, connectionId],
  );
  const overlaps = useMemo(
    () =>
      findSubnetOverlaps(
        networks.map((network) => ({
          name: network.name,
          subnets: (network.subnets ?? []).map((entry) => entry.subnet).filter(Boolean),
        })),
      ),
    [networks],
  );
  const overlapNames = useMemo(() => new Set(overlaps.flatMap((overlap) => [overlap.a, overlap.b])), [overlaps]);

  return (
    <div className="subCard">
      <div className="CardHead">
        <h5>{t("Networking")}</h5>
        {overlaps.length > 0 ? (
          <span className="pathBroken">{t("{{count}} subnet overlap", { count: overlaps.length })}</span>
        ) : null}
      </div>
      {networks.length === 0 ? (
        <div className="muted">{t("No custom networks.")}</div>
      ) : (
        <table className="AppDataTable">
          <thead>
            <tr>
              <th>{t("Network")}</th>
              <th>{t("Subnet")}</th>
              <th>{t("Driver")}</th>
              <th>{t("Health")}</th>
            </tr>
          </thead>
          <tbody>
            {networks.map((network) => {
              const subnets = (network.subnets ?? []).map((entry) => entry.subnet).filter(Boolean);
              const flagged = overlapNames.has(network.name);
              return (
                <tr key={network.id || network.name}>
                  <td>{network.name}</td>
                  <td>
                    {subnets.length > 0 ? (
                      subnets.map((subnet) => (
                        <code key={subnet} className="subnetCode">
                          {subnet}
                        </code>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{network.driver}</td>
                  <td className={flagged ? "netwarn" : "netok"}>{flagged ? `▲ ${t("overlap")}` : `● ${t("ok")}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

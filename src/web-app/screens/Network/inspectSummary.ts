import type { Network } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId, yesNo } from "@/web-app/components/inspectSummary.helpers";

// Only the cross-engine-meaningful network fields. Docker/Apple hard-code `network_interface`,
// `dns_enabled`, `options` and `subnets` (see docker normalizeNetwork), so those are intentionally
// left to the raw JSON below rather than shown as misleading empty rows.
export function buildNetworkSummary(network: Network): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  if (network.name) {
    rows.push({ key: "name", label: t("Name"), value: network.name, copyText: network.name });
  }
  if (network.id) {
    rows.push({
      key: "id",
      label: t("Id"),
      value: shortId(network.id),
      copyText: network.id,
      mono: true,
      render: "code",
    });
  }
  if (network.driver) {
    rows.push({ key: "driver", label: t("Driver"), value: network.driver, render: "tag" });
  }
  rows.push({ key: "internal", label: t("Internal"), value: yesNo(network.internal) });
  rows.push({ key: "ipv6", label: t("IPv6"), value: yesNo(network.ipv6_enabled) });
  if (network.created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(network.created) });
  }
  return rows;
}

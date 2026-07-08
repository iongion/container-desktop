import type { Volume } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate } from "@/web-app/components/inspectSummary.helpers";

// Volume shape is identical across engines (only the list envelope differs), so these read the same
// everywhere. Mountpoint is the copy-worthy path.
export function buildVolumeSummary(volume: Volume): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  if (volume.Name) {
    rows.push({ key: "name", label: t("Name"), value: volume.Name, copyText: volume.Name });
  }
  if (volume.Driver) {
    rows.push({ key: "driver", label: t("Driver"), value: volume.Driver });
  }
  if (volume.Scope) {
    rows.push({ key: "scope", label: t("Scope"), value: volume.Scope });
  }
  if (volume.Mountpoint) {
    rows.push({
      key: "mountpoint",
      label: t("Mountpoint"),
      value: volume.Mountpoint,
      copyText: volume.Mountpoint,
      mono: true,
    });
  }
  if (volume.CreatedAt) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(volume.CreatedAt) });
  }
  return rows;
}

import type { Secret } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId } from "@/web-app/components/inspectSummary.helpers";

// Secret shape is identical across Podman & Docker (no Apple secrets), so no reconciliation needed.
export function buildSecretSummary(secret: Secret): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  const name = secret.Spec?.Name;
  if (name) {
    rows.push({ key: "name", label: t("Name"), value: name, copyText: name });
  }
  if (secret.ID) {
    rows.push({
      key: "id",
      label: t("Id"),
      value: shortId(secret.ID),
      copyText: secret.ID,
      mono: true,
      render: "code",
    });
  }
  const driver = secret.Spec?.Driver?.Name;
  if (driver) {
    rows.push({ key: "driver", label: t("Driver"), value: driver, render: "tag" });
  }
  if (secret.CreatedAt) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(secret.CreatedAt) });
  }
  if (secret.UpdatedAt) {
    rows.push({ key: "updated", label: t("Updated"), value: inspectDate(secret.UpdatedAt) });
  }
  return rows;
}

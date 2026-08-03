import prettyBytes from "pretty-bytes";

import type { ContainerImage } from "@/container-client/types/image";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId } from "@/web-app/components/inspectSummary.helpers";

// The most important, engine-common image facts (echoes the Images list columns + digest). Every value
// is a normalizer-computed field (Name/Tag/Registry/FullName), so it reads the same for Podman & Docker.
export function buildImageSummary(image: ContainerImage): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  if (image.Name) {
    rows.push({ key: "name", label: t("Name"), value: image.Name, copyText: image.Name });
  }
  if (image.Registry) {
    rows.push({ key: "registry", label: t("Registry"), value: image.Registry, render: "tag" });
  }
  if (image.Tag) {
    rows.push({ key: "tag", label: t("Tag"), value: image.Tag, render: "tag" });
  }
  // Digest is as identity-critical as the tag (the immutable content ref). Podman populates `Digest`;
  // Docker leaves it empty and carries `repo@sha256:…` in RepoDigests[] — take the part after `@`.
  const digest = image.Digest || image.RepoDigests?.[0]?.split("@")[1] || image.RepoDigests?.[0] || "";
  if (digest) {
    rows.push({ key: "digest", label: t("Digest"), value: digest, copyText: digest, mono: true, render: "code" });
  }
  if (image.Id) {
    rows.push({
      key: "id",
      label: t("Id"),
      value: shortId(image.Id),
      copyText: image.Id,
      mono: true,
      render: "code",
    });
  }
  if (typeof image.Size === "number") {
    rows.push({ key: "size", label: t("Size"), value: prettyBytes(image.Size) });
  }
  if (typeof image.Containers === "number") {
    rows.push({ key: "containers", label: t("In use by"), value: `${image.Containers}` });
  }
  // `Created` may be epoch seconds (list) or an ISO string (inspect) — inspectDate handles both.
  if (image.Created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(image.Created) });
  }
  return rows;
}

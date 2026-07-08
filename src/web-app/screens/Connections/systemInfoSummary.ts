import prettyBytes from "pretty-bytes";

import { ContainerEngine, type SystemInfo } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";

// System `info` has two genuinely different runtime shapes: Podman (libpod) nests everything under
// host/store/version, while Docker AND Apple return the flat Docker `/info` (Apple speaks the Docker REST
// surface). So branch on the selected connection's engine. Unknown/missing fields are simply omitted.
export function buildSystemInfoSummary(info: SystemInfo | any, engine?: ContainerEngine): InspectSummaryRow[] {
  if (!info) {
    return [];
  }
  const rows: InspectSummaryRow[] = [];
  const push = (key: string, label: string, value: unknown) => {
    if (value !== undefined && value !== null && `${value}` !== "") {
      rows.push({ key, label, value: `${value}` });
    }
  };
  const pushOsKernel = (os: unknown, kernel: unknown) => {
    const value = [os, kernel].filter((part) => part !== undefined && part !== null && `${part}` !== "").join(" · ");
    push("osKernel", t("OS / Kernel"), value);
  };
  const bytes = (v: unknown) => (typeof v === "number" && !Number.isNaN(v) ? prettyBytes(v) : undefined);

  if (engine === ContainerEngine.PODMAN) {
    const host = info.host || {};
    const store = info.store || {};
    const version = info.version || {};
    const distro = host.distribution?.distribution
      ? `${host.distribution.distribution}${host.distribution.version ? ` ${host.distribution.version}` : ""}`
      : host.os;
    push("engineVersion", t("Engine version"), version.Version);
    push("apiVersion", t("API version"), version.APIVersion);
    pushOsKernel(distro, host.kernel);
    push("arch", t("Architecture"), host.arch);
    push("cpus", t("CPUs"), host.cpus);
    push("memory", t("Memory"), bytes(host.memTotal));
    push("containers", t("Containers"), store.containerStore?.number);
    push("images", t("Images"), store.imageStore?.number);
    push("storage", t("Storage driver"), store.graphDriverName);
  } else {
    // Docker + Apple: flat /info payload.
    push("engineVersion", t("Engine version"), info.ServerVersion);
    push("apiVersion", t("API version"), info.ApiVersion);
    pushOsKernel(info.OperatingSystem, info.KernelVersion);
    push("arch", t("Architecture"), info.Architecture);
    push("cpus", t("CPUs"), info.NCPU);
    push("memory", t("Memory"), bytes(info.MemTotal));
    push("containers", t("Containers"), info.Containers);
    push("images", t("Images"), info.Images);
    push("storage", t("Storage driver"), info.Driver);
  }
  return rows;
}

import { Callout, Icon, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { capabilitiesFor } from "@/container-provisioning/platform";
import { PROBE_PROGRAMS } from "@/container-provisioning/provisioningService";
import { preferredEngine } from "@/container-provisioning/targetDefaults";
import type { DetectedProgram } from "@/container-provisioning/types";
import { Presence } from "@/env/Types";
import i18n from "@/i18n";
import { engineLabel } from "@/web-app/components/EngineCell";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

import { runDetection } from "../useProvisioning";

// Proper display names so probe rows read correctly (not the capitalize-mangled "Wsl"/"Ssh").
const PROBE_LABELS: Record<string, string> = {
  podman: "Podman",
  docker: "Docker",
  container: "Apple Container",
  wsl: "WSL",
  limactl: "Lima",
  ssh: "SSH",
};

// Programs that only exist on one platform — still listed on other OSes for consistency, but disabled with
// the reason instead of being probed (podman/docker/ssh work everywhere, so they're never disabled).
const PROBE_ONLY_ON: Record<string, string> = {
  container: i18n.t("macOS only"),
  limactl: i18n.t("macOS only"),
  wsl: i18n.t("Windows only"),
};

// Step 1 — probe the machine and tick each program off as its check resolves (never a single blocking
// spinner). The whole probe list is shown up front so the user sees exactly what's being checked; each row
// flips from spinner → found/not-found the moment that check returns. The recommendation appears once done.
export function SystemCheckStep() {
  const { t } = useTranslation();
  const detection = useProvisioningStore((s) => s.detection);
  const [results, setResults] = useState<Record<string, DetectedProgram>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Revisiting the step: show the cached report immediately, no re-probe.
    if (detection) {
      setResults(Object.fromEntries(detection.programs.map((program) => [program.name, program])));
      setDone(true);
      return;
    }
    let alive = true;
    setResults({});
    setDone(false);
    void runDetection((program) => {
      if (alive) {
        setResults((current) => ({ ...current, [program.name]: program }));
      }
    }).finally(() => {
      if (alive) {
        setDone(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [detection]);

  const recommended = done && detection ? preferredEngine(detection) : undefined;
  const reusable = done && detection ? detection.scopes.find((scope) => scope.usable) : undefined;
  // Programs relevant to this OS get a live probe; the rest are still listed (for consistency) but disabled.
  const applicable = new Set(capabilitiesFor(Application.getInstance().getOsType()).probes);

  return (
    <div className="PWizSystemCheck">
      <ul className="PWizProbeList">
        {PROBE_PROGRAMS.map((name) => {
          const na = !applicable.has(name);
          const result = results[name];
          const checking = !na && !result;
          const found = result?.present === Presence.AVAILABLE;
          const icon = na ? (
            <Icon icon={IconNames.DISABLE} color="var(--app-text-muted)" />
          ) : checking ? (
            <Spinner size={16} />
          ) : (
            <Icon
              icon={found ? IconNames.TICK_CIRCLE : IconNames.MINUS}
              color={found ? "var(--app-intent-success-rest)" : "var(--app-text-muted)"}
            />
          );
          const state = na
            ? t(PROBE_ONLY_ON[name] ?? "not applicable")
            : checking
              ? t("checking…")
              : found
                ? (result?.version ?? t("found"))
                : t("not found");
          return (
            <li key={name} className={`PWizProbe${checking ? " is-checking" : ""}${na ? " is-na" : ""}`}>
              {icon}
              <span className="PWizProbeName">{PROBE_LABELS[name] ?? name}</span>
              <span className="PWizProbeState">{state}</span>
            </li>
          );
        })}
      </ul>
      {reusable ? (
        <Callout intent="none" icon={IconNames.BOX} title={t("Existing runtime found")}>
          {t("You can reuse “{{name}}” instead of creating a new one — the wizard will pick it up automatically.", {
            name: reusable.name,
          })}
        </Callout>
      ) : null}
      {recommended ? (
        <Callout
          intent="primary"
          icon={IconNames.LIGHTBULB}
          title={t("Recommended engine: {{engine}}", { engine: engineLabel(recommended) })}
        >
          {t("Chosen from what's already on your machine — you can change it in the next step.")}
        </Callout>
      ) : null}
    </div>
  );
}

import { Callout } from "@blueprintjs/core";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { capabilitiesFor, WIZARD_ENGINES } from "@/container-provisioning/platform";
import { preferredEngine, targetFor } from "@/container-provisioning/targetDefaults";
import { ContainerEngine } from "@/env/Types";
import { engineLabel } from "@/web-app/components/EngineCell";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

const ENGINE_TAGLINE: Record<string, string> = {
  podman: "Daemonless, rootless-first.",
  docker: "The familiar workflow.",
  container: "Apple's native runtime — no VM.",
};

// The card title shown in the wizard. Apple's engine wire-name is bare "container"; spell it out here so a
// first-run user isn't left guessing (the rest of the app keeps the short "Container" label).
function cardTitle(engine: ContainerEngine): string {
  return engine === ContainerEngine.APPLE ? "Apple Container" : engineLabel(engine);
}

const STRATEGY_BLURB: Record<string, string> = {
  "reuse.installed": "Reuse the engine already installed on your machine — nothing to create.",
  "apple.container": "Use Apple's native container runtime — Apple-silicon Mac only (experimental).",
  "colima.lima": "Create a lightweight Linux VM (Lima) to run the engine.",
  "wsl.import": "Import a WSL distro to run the engine inside.",
  "native.install": "Install the engine + compose natively on this machine.",
};

// Step 2 — pick the engine (per-OS default pre-selected). Selecting one derives the whole target
// (strategy + host) via the ladder; the callout explains what will happen.
export function EngineStep() {
  const { t } = useTranslation();
  const detection = useProvisioningStore((s) => s.detection);
  const target = useProvisioningStore((s) => s.target);
  const setTarget = useProvisioningStore((s) => s.setTarget);

  // Pre-select the recommended engine the first time we land here with a detection but no target yet.
  useEffect(() => {
    if (detection && !target) {
      setTarget(targetFor(preferredEngine(detection), detection));
    }
  }, [detection, target, setTarget]);

  if (!detection) {
    return null;
  }

  // Always show every engine, but only let the user pick ones provisionable on this OS. Apple Container stays
  // visible (with its badge) on Linux/Windows so it's discoverable, just disabled — not hidden.
  const selectable = capabilitiesFor(detection.osType).engines;

  return (
    <div className="PWizEngine">
      <div className="PWizEngineCards">
        {WIZARD_ENGINES.map((engine) => {
          const enabled = selectable.includes(engine);
          const active = enabled && target?.engine === engine;
          const experimental = engine === ContainerEngine.APPLE;
          return (
            <button
              type="button"
              key={engine}
              className={`PWizEngineCard${active ? " is-active" : ""}`}
              data-engine-marker={engine}
              disabled={!enabled}
              title={enabled ? undefined : t("Available on macOS only")}
              onClick={() => setTarget(targetFor(engine, detection))}
            >
              {experimental ? <span className="PWizEngineExp">{t("Experimental")}</span> : null}
              <span className="PWizEngineIcon" aria-hidden="true" />
              <span className="PWizEngineName">{t(cardTitle(engine))}</span>
              <span className="PWizEngineTag">
                {enabled ? t(ENGINE_TAGLINE[engine]) : t("Available on macOS only")}
              </span>
            </button>
          );
        })}
      </div>
      {target ? (
        <Callout intent="primary" title={t("Setup for {{engine}}", { engine: cardTitle(target.engine) })}>
          {t(STRATEGY_BLURB[target.strategy] ?? "")}
        </Callout>
      ) : null}
    </div>
  );
}

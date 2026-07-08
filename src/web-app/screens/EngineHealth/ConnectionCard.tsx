import { Button, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import { useTranslation } from "react-i18next";

import type { ReachabilityDiagnosis } from "@/container-client/reachability/model";
import { ChainPipe } from "@/web-app/components/ChainPipe/ChainPipe";
import { Diagnosis } from "@/web-app/components/Diagnosis/Diagnosis";
import { EngineCell } from "@/web-app/components/EngineCell";
import { useResourceStore } from "@/web-app/stores/resourceStore";

import { BindMountsPanel } from "./BindMountsPanel";
import type { FleetConnection } from "./fleet";
import { MachinePanel } from "./MachinePanel";
import { NetworkingPanel } from "./NetworkingPanel";
import { derivePath } from "./path";
import { useSystemDf } from "./queries";
import type { VerdictLevel } from "./verdict";

const LEVEL_CLASS: Record<VerdictLevel, string> = {
  healthy: "ok",
  degraded: "warn",
  unreachable: "err",
};

interface ConnectionCardProps {
  card: FleetConnection;
  /** Effective verdict (runtime folded with panel issues) — drives the pill + border. */
  level: VerdictLevel;
  diagnoses: ReachabilityDiagnosis[];
  expanded: boolean;
  onToggle: () => void;
  onRecheck: () => void;
}

// One connection = one collapsible group card. Header carries the engine glyph, name, transport subtitle,
// verdict pill, vitals and per-connection actions; the verdict tints the left border. The body composes the
// health panels (added per increment: connection-path, machine, networking, bind-mounts, diagnostics).
export function ConnectionCard({ card, level, diagnoses, expanded, onToggle, onRecheck }: ConnectionCardProps) {
  const { t } = useTranslation();
  const snapshot = useResourceStore((state) => state.byConnection[card.id]);
  const containers = snapshot?.containers?.items?.length ?? 0;
  const images = snapshot?.images?.items?.length ?? 0;
  const klass = LEVEL_CLASS[level];
  const hops = derivePath(card);
  const failingHop = hops.find((hop) => hop.state === "err");
  const df = useSystemDf(card.id).data;
  const machinesCap = !!(
    card.connector?.capabilities?.extensions?.machines ?? card.runtime.capabilities?.extensions?.machines
  );
  const hasMachine = card.transport === "vm" && machinesCap;
  const machineScope = card.connector?.settings?.controller?.scope ?? card.connection?.settings?.controller?.scope;

  const pillText =
    level === "unreachable"
      ? t("Unreachable")
      : level === "degraded"
        ? diagnoses.length > 0
          ? `${t("Degraded")} · ${t("{{count}} issues", { count: diagnoses.length })}`
          : t("Degraded")
        : t("Healthy");

  // Vitals use the RUNTIME level (an unreachable engine shows its error; a running-but-degraded one shows counts).
  const vitals =
    card.verdict.level === "unreachable"
      ? card.verdict.reasons[0] || t("unreachable")
      : [card.version ? `v${card.version}` : null, `${containers} ${t("containers")}`, `${images} ${t("images")}`]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className={`ConnCard ${klass}${expanded ? "" : " collapsed"}`}>
      {/* The whole header toggles collapse (matches the mockup); clicks on the actions are ignored. A semantic
          <button> can't wrap the nested action buttons, so this is a keyboard-accessible role="button" div. */}
      {/* biome-ignore lint/a11y/useSemanticElements: div-as-button — a real <button> can't contain the actions */}
      <div
        className="ConnHead"
        role="button"
        tabIndex={0}
        title={card.name}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest(".acts")) {
            onToggle();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <Icon className="chev" icon={IconNames.CHEVRON_DOWN} />
        <EngineCell engine={card.engine} connectionName={card.name} />
        <span className="cn">{card.name}</span>
        <span className="ct">{card.subtitle}</span>
        <span className={`vpill ${klass}`}>{pillText}</span>
        <span className="vitals">{vitals}</span>
        <span className="acts">
          <Button variant="minimal" size="small" icon={IconNames.REFRESH} title={t("Re-check")} onClick={onRecheck} />
        </span>
      </div>
      <div className="ConnBody">
        {diagnoses.map((diagnosis) => (
          <Diagnosis key={`${diagnosis.tone}-${diagnosis.headline}`} diagnosis={diagnosis} />
        ))}
        <div className="subCard">
          <div className="CardHead">
            <h5>{t("Connection path")}</h5>
            {level === "unreachable" && failingHop ? (
              <span className="pathBroken">{t("broken at {{hop}}", { hop: failingHop.name })}</span>
            ) : null}
          </div>
          <ChainPipe hops={hops} />
        </div>
        <div className="grid2">
          {hasMachine ? (
            <MachinePanel connectionId={card.id} scope={machineScope} df={df} />
          ) : (
            <div className="subCard">
              <div className="CardHead">
                <h5>{t("Runtime")}</h5>
                <span className="statePill remote">{card.transportLabel}</span>
              </div>
              <div className="kv">
                <span>
                  {t("Containers")} <b>{containers}</b>
                </span>
                <span>
                  {t("Images")} <b>{images}</b>
                </span>
                {card.version ? (
                  <span>
                    {t("Version")} <b>{card.version}</b>
                  </span>
                ) : null}
                {df && df.imagesSize > 0 ? (
                  <span>
                    {t("Disk")} <b>{prettyBytes(df.imagesSize)}</b>
                    {df.imagesReclaimable > 0 ? (
                      <span className="muted">
                        {" · "}
                        {prettyBytes(df.imagesReclaimable)} {t("reclaimable")}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {card.verdict.reasons.length > 0 ? (
                <div className="kv">
                  <span className="muted">{card.verdict.reasons.join(" · ")}</span>
                </div>
              ) : null}
            </div>
          )}
          <NetworkingPanel connectionId={card.id} />
        </div>
        <BindMountsPanel connectionId={card.id} />
      </div>
    </div>
  );
}

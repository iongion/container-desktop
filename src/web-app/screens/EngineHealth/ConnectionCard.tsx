import { Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import type { KeyboardEvent } from "react";
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

interface ConnectionHealthHeaderProps {
  card: FleetConnection;
  /** Effective verdict (runtime folded with panel issues) — drives the pill + border. */
  level: VerdictLevel;
  diagnoses: ReachabilityDiagnosis[];
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

interface ConnectionHealthContentProps {
  card: FleetConnection;
  level: VerdictLevel;
  diagnoses: ReachabilityDiagnosis[];
}

export function ConnectionHealthHeader({
  card,
  level,
  diagnoses,
  collapsible = false,
  expanded = true,
  onToggle,
}: ConnectionHealthHeaderProps) {
  const { t } = useTranslation();
  const snapshot = useResourceStore((state) => state.byConnection[card.id]);
  const containers = snapshot?.containers?.items?.length ?? 0;
  const images = snapshot?.images?.items?.length ?? 0;
  const klass = LEVEL_CLASS[level];
  const canCollapse = collapsible && !!onToggle;
  const onHeaderClick = canCollapse && onToggle ? () => onToggle() : undefined;
  const onHeaderKeyDown =
    canCollapse && onToggle
      ? (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }
      : undefined;

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
    <>
      {/* The whole header toggles collapse when enabled. */}
      {/* biome-ignore lint/a11y/useSemanticElements: div-as-button — a real <button> would not fit this layout */}
      <div
        className={`ConnHead ${klass}${canCollapse && !expanded ? " collapsed" : ""}`}
        role={canCollapse ? "button" : undefined}
        tabIndex={canCollapse ? 0 : undefined}
        title={card.name}
        onClick={onHeaderClick}
        onKeyDown={onHeaderKeyDown}
      >
        {canCollapse ? <Icon className="chev" icon={IconNames.CHEVRON_DOWN} /> : null}
        <EngineCell engine={card.engine} connectionName={card.name} />
        <span className="cn">{card.name}</span>
        <span className="ct">{card.subtitle}</span>
        <span className={`vpill ${klass}`}>{pillText}</span>
        <span className="vitals">{vitals}</span>
      </div>
    </>
  );
}

export function ConnectionHealthContent({ card, level, diagnoses }: ConnectionHealthContentProps) {
  const { t } = useTranslation();
  const snapshot = useResourceStore((state) => state.byConnection[card.id]);
  const containers = snapshot?.containers?.items?.length ?? 0;
  const images = snapshot?.images?.items?.length ?? 0;
  const hops = derivePath(card);
  const failingHop = hops.find((hop) => hop.state === "err");
  const df = useSystemDf(card.id).data;
  const machinesCap = !!(
    card.connector?.capabilities?.extensions?.machines ?? card.runtime.capabilities?.extensions?.machines
  );
  const hasMachine = card.transport === "vm" && machinesCap;
  const machineScope = card.connector?.settings?.controller?.scope ?? card.connection?.settings?.controller?.scope;

  return (
    <>
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
    </>
  );
}

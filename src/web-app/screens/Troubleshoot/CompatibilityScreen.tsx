import { Callout, Icon, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { Fragment } from "react";

import i18n, { t } from "@/i18n";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { buildCompatibilityMatrix, FOOTNOTES, type MatrixCell } from "./compatibility/matrix";
import { ScreenHeader } from "./ScreenHeader";
import "./CompatibilityScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "troubleshoot.compatibility";
export const View = "compatibility";
export const Title = i18n.t("Compatibility");

function CompatibilityCell({ cell }: { cell: MatrixCell }) {
  const sup = cell.footnote ? <sup>{cell.footnote}</sup> : null;
  switch (cell.kind) {
    case "value":
      return <span className={`CompatVal CompatVal--${cell.value}`}>{cell.value}</span>;
    case "yes":
      return (
        <span className="CompatMark yes" title={t("Supported")}>
          <Icon icon={IconNames.TICK} />
        </span>
      );
    case "partial":
      return (
        <span className="CompatMark warn" title={t("Partial")}>
          <Icon icon={IconNames.WARNING_SIGN} />
          {sup}
        </span>
      );
    case "planned":
      return (
        <span className="CompatMark soon" title={t("Planned")}>
          <Icon icon={IconNames.TIME} />
          {sup}
        </span>
      );
    default:
      return (
        <span className="CompatMark no" title={t("Not supported")}>
          —{sup}
        </span>
      );
  }
}

// Engine Compatibility matrix — a Troubleshoot sub-screen. GLOBAL/merged comparison of what each connected
// engine supports (from the capabilities already on activeRuntime); connections are COLUMNS, capabilities are
// ROWS. NO ConnectionSelect — this is a comparison, so the connections ARE the axis.
export const Screen: AppScreen<ScreenProps> = () => {
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const matrix = buildCompatibilityMatrix(activeRuntime);
  const { columns, groups } = matrix;

  const engineCount = columns.length;
  const connectedCount = columns.filter((c) => c.connected).length;
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const usedFootnotes = Array.from(
    new Set(groups.flatMap((g) => g.rows.flatMap((r) => r.cells.map((c) => c.footnote).filter(Boolean)))),
  ).sort((a, b) => (a as number) - (b as number)) as number[];

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} />
      <div className="AppScreenContent">
        {columns.length === 0 ? (
          <NonIdealState
            icon={IconNames.COMPARISON}
            title={t("No connected engines")}
            description={t("Connect an engine to compare what each supports across all connections.")}
          />
        ) : (
          <div className="CompatibilityMatrix">
            <div className="CompatSumBar">
              <span>
                <b>{engineCount}</b> {t("engines")} · <b>{connectedCount}</b> {t("connected")} · {t("comparing")}{" "}
                <b>{rowCount}</b> {t("capabilities")}
              </span>
              <span className="CompatSpacer" />
              <span className="CompatLegend">
                <span className="lg">
                  <span className="CompatMark yes">
                    <Icon icon={IconNames.TICK} />
                  </span>{" "}
                  {t("supported")}
                </span>
                <span className="lg">
                  <span className="CompatMark warn">
                    <Icon icon={IconNames.WARNING_SIGN} />
                  </span>{" "}
                  {t("partial")}
                </span>
                <span className="lg">
                  <span className="CompatMark no">—</span> {t("not supported")}
                </span>
                <span className="lg">
                  <span className="CompatMark soon">
                    <Icon icon={IconNames.TIME} />
                  </span>{" "}
                  {t("planned")}
                </span>
              </span>
            </div>

            <div className="CompatMatrixWrap">
              <table className="CompatMatrix">
                <thead>
                  <tr>
                    <th className="capcol">{t("Capability")}</th>
                    {columns.map((col) => (
                      <th className="conn" key={col.engine} data-connected={col.connected ? "yes" : "no"}>
                        <div className="ch">
                          <EngineCell engine={col.engine} connectionName={engineLabel(col.engine)} />
                          <div className="chn">{engineLabel(col.engine)}</div>
                          {col.versions.length > 0 ? (
                            <div className="chvs">
                              {col.versions.map((v) => (
                                <div className="chv" key={v}>
                                  v{v}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="chv na">{t("n/a")}</div>
                          )}
                          {col.connectionCount > 1 ? (
                            <div className="cht">
                              {col.connectionCount} {t("connections")}
                            </div>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.title}>
                      <tr className="cat">
                        <td colSpan={columns.length + 1}>{group.title}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="cap">
                            {row.label}
                            {row.note ? <span className="capnote">{row.note}</span> : null}
                          </td>
                          {row.cells.map((cell, i) => (
                            <td key={columns[i].engine}>
                              <CompatibilityCell cell={cell} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <Callout icon={IconNames.LIGHTBULB} className="CompatInsight">
              <h5>{t("Why capabilities differ across your connections")}</h5>
              <p>
                {t(
                  'Two axes decide each cell. Engine dialect — Podman speaks libpod (pods, secrets, kube, native Compose); Docker speaks the docker API (Swarm). Transport — machine lifecycle only works on a native Podman, never over SSH. The clock marks capabilities on the roadmap the app doesn\'t detect yet — never "broken," just not wired.',
                )}
              </p>
            </Callout>

            {usedFootnotes.length > 0 ? (
              <div className="CompatFoot">
                {usedFootnotes.map((n) => (
                  <div className="CompatFootLine" key={n}>
                    <b>{n}</b> {FOOTNOTES[n]}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/troubleshoot/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COMPARISON,
  ExcludeFromSidebar: true,
};

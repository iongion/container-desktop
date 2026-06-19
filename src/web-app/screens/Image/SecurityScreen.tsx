import { AnchorButton, Button, ButtonGroup, HTMLTable, Icon, NonIdealState, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SecurityReportResultGroup, SecurityVulnerability } from "@/env/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./SecurityScreen.css";
import { useImage, useImageSecurity } from "./queries";

export const ID = "image.security";
export const Title = "Image Security";

export interface ScreenProps extends AppScreenProps {}

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
const SEVERITY_LABELS: Record<(typeof SEVERITIES)[number], string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

interface SecurityFinding {
  group: SecurityReportResultGroup;
  vulnerability: SecurityVulnerability;
}

function formatRelativeDate(value?: string): string {
  return value ? (dayjs(value) as any).fromNow() : "—";
}

function formatPublishedDate(value?: string): string {
  return value ? dayjs(value).format("DD MMM YYYY HH:mm") : "—";
}

function severityCount(counts: Record<string, number> | undefined, severity: string): number {
  return counts?.[severity] ?? 0;
}

function vulnerabilityDescription(vulnerability: SecurityVulnerability): string {
  return vulnerability.Description || "";
}

function shouldShowDescriptionToggle(value?: string): boolean {
  return (value?.length ?? 0) > 180;
}

function sortFindings(left: SecurityFinding, right: SecurityFinding): number {
  const severityDelta =
    (SEVERITY_RANK[left.vulnerability.Severity] ?? 99) - (SEVERITY_RANK[right.vulnerability.Severity] ?? 99);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return dayjs(right.vulnerability.Published).valueOf() - dayjs(left.vulnerability.Published).valueOf();
}

function findingKey(group: SecurityReportResultGroup, vulnerability: SecurityVulnerability): string {
  return (
    vulnerability.guid ||
    `${group.Target}:${vulnerability.VulnerabilityID}:${vulnerability.PrimaryURL}:${vulnerability.Published}`
  );
}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>(["CRITICAL", "HIGH"]);
  const [expandedDescriptions, setExpandedDescriptions] = useState<string[]>([]);
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const imageQuery = useImage(connectionId, decodedId);
  const image = imageQuery.data;
  const securityQuery = useImageSecurity(connectionId, decodedId, image?.FullName);
  const report = securityQuery.data;
  const pending = imageQuery.isLoading || imageQuery.isFetching;
  const scanning = securityQuery.isLoading || securityQuery.isFetching;
  const counts = report?.counts;
  const findings: SecurityFinding[] = (report?.result?.Results || [])
    .flatMap((group: SecurityReportResultGroup) =>
      (group.Vulnerabilities || []).map((vulnerability: SecurityVulnerability) => ({ group, vulnerability })),
    )
    .sort(sortFindings);
  const filteredFindings = selectedSeverities.length
    ? findings.filter(({ vulnerability }) => selectedSeverities.includes(vulnerability.Severity))
    : findings;
  const totalCount = SEVERITIES.reduce((total, severity) => total + severityCount(counts, severity), 0);
  const visibleCount = filteredFindings.length;
  const filtersActive = selectedSeverities.length > 0;

  const toggleSeverityFilter = (severity: string) => {
    setSelectedSeverities((current) =>
      current.includes(severity) ? current.filter((item) => item !== severity) : [...current, severity],
    );
  };

  const toggleDescription = (guid: string) => {
    setExpandedDescriptions((current) =>
      current.includes(guid) ? current.filter((item) => item !== guid) : [...current, guid],
    );
  };

  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        {scanning ? (
          <ScreenLoader screen={ID} pending={pending || scanning} description={t("Scanning for vulnerabilities")} />
        ) : (
          <>
            <section className="SecurityScanSummary" aria-label={t("Security report summary")}>
              <ButtonGroup className="SecuritySeverityFilters" variant="outlined">
                {SEVERITIES.map((severity) => {
                  const active = selectedSeverities.includes(severity);
                  return (
                    <Button
                      active={active}
                      aria-pressed={active}
                      className="SecuritySeverityFilter"
                      data-severity={severity}
                      data-muted={filtersActive && !active ? "yes" : "no"}
                      key={severity}
                      size="small"
                      onClick={() => toggleSeverityFilter(severity)}
                      title={t("Filter by {{severity}}", { severity: t(SEVERITY_LABELS[severity]) })}
                    >
                      <Tag
                        round
                        minimal
                        className="SecuritySeverityCountTag"
                        data-severity={severity}
                        aria-label={t("{{count}} {{severity}} vulnerabilities", {
                          count: severityCount(counts, severity),
                          severity: t(SEVERITY_LABELS[severity]),
                        })}
                      >
                        {severityCount(counts, severity)}
                      </Tag>
                      &nbsp;
                      <span>{t(SEVERITY_LABELS[severity])}</span>
                    </Button>
                  );
                })}
              </ButtonGroup>
              <div className="SecurityScanSummaryLead">
                <span className="SecurityScanTotal">{filtersActive ? visibleCount : totalCount}</span>
                <span className="SecurityScanTotalLabel">
                  {t((filtersActive ? visibleCount : totalCount) === 1 ? "vulnerability" : "vulnerabilities")}
                </span>
              </div>
              <div className="SecurityScanSummarySpacer" aria-hidden="true" />
              <div className="SecurityScannerMeta">
                <span>
                  {t("Scanner")} <strong>{report?.scanner?.name || "trivy"}</strong>
                  {report?.scanner?.version ? <code>{report.scanner.version}</code> : null}
                </span>
                <span>
                  {t("Database")} <strong>{report?.scanner?.database?.VulnerabilityDB?.Version || "—"}</strong>
                </span>
                <span>
                  {t("Updated")}{" "}
                  <strong>{formatRelativeDate(report?.scanner?.database?.VulnerabilityDB?.UpdatedAt)}</strong>
                </span>
                <AnchorButton
                  className="SecurityExternalLink"
                  icon={IconNames.LINK}
                  href="https://trivy.dev"
                  target="_blank"
                  rel="noopener"
                  size="small"
                  variant="minimal"
                  text="trivy.dev"
                />
              </div>
            </section>

            {report?.scanner?.path && report?.status === "success" ? (
              <div className="SecurityList">
                <HTMLTable compact className="AppDataTable" data-table="image.scanning.report">
                  <colgroup>
                    <col className="SecurityColumnSeverity" />
                    <col className="SecurityColumnVulnerability" />
                    <col className="SecurityColumnTarget" />
                    <col className="SecurityColumnType" />
                    <col className="SecurityColumnPublished" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="SecurityCellSeverity">{t("Severity")}</th>
                      <th className="SecurityCellFinding">{t("Vulnerability ID")}</th>
                      <th className="SecurityCellTarget">{t("Target")}</th>
                      <th className="SecurityCellType">{t("Type")}</th>
                      <th className="SecurityCellPublished">{t("Published")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFindings.map(({ group, vulnerability }) => {
                      const key = findingKey(group, vulnerability);
                      const expanded = expandedDescriptions.includes(key);
                      const description = vulnerabilityDescription(vulnerability);
                      const canToggleDescription = shouldShowDescriptionToggle(description);
                      return (
                        <tr key={key} data-severity={vulnerability.Severity}>
                          <td className="SecurityCellSeverity">
                            <span
                              className="SecuritySeverityBadge SecuritySeverityBadgeCompact"
                              data-severity={vulnerability.Severity}
                            >
                              {vulnerability.Severity}
                            </span>
                          </td>
                          <td className="SecurityCellFinding">
                            <div className="SecurityFindingText">
                              <a
                                className="SecurityFindingLink"
                                href={vulnerability.PrimaryURL}
                                target="_blank"
                                rel="noopener"
                              >
                                <Icon className="SecurityFindingLinkIcon" icon={IconNames.LINK} size={12} />
                                <span className="SecurityFindingLinkText">{vulnerability.VulnerabilityID}</span>
                              </a>
                              {description ? (
                                <p className="SecurityFindingDescription" data-expanded={expanded ? "yes" : "no"}>
                                  {description}
                                </p>
                              ) : null}
                              {canToggleDescription ? (
                                <button
                                  className="SecurityDescriptionToggle"
                                  type="button"
                                  onClick={() => toggleDescription(key)}
                                >
                                  {expanded ? t("Show less") : t("Show more")}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="SecurityCellTarget">
                            <span className="SecurityFindingTarget">{group.Target}</span>
                            <span className="SecurityFindingMeta">{group.Class}</span>
                          </td>
                          <td className="SecurityCellType">{group.Type}</td>
                          <td className="SecurityCellPublished">{formatPublishedDate(vulnerability.Published)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </HTMLTable>
              </div>
            ) : (
              <NonIdealState
                icon={IconNames.WARNING_SIGN}
                title={t("Report could not be generated")}
                description={
                  report?.scanner?.path ? (
                    <p>{t("An internal error occurred, please report the issue.")}</p>
                  ) : (
                    <p>{t("Please install trivy and then revisit this screen")}</p>
                  )
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/image/$id/security",
};
Screen.Metadata = {
  LeftIcon: IconNames.CONFIRM,
  ExcludeFromSidebar: true,
};

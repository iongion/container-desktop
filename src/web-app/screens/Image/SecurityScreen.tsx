import { AnchorButton, Button, ButtonGroup, HTMLTable, Icon, Intent, NonIdealState, Switch } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { saveAs } from "file-saver";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type SbomPackage,
  type SecuritySignatureResult,
  summarizeSbomLicenses,
} from "@/container-client/application/security";
import type { SecurityReportResultGroup, SecurityVulnerability } from "@/env/Types";
import i18n from "@/i18n";
import { CopyToClipboardInput } from "@/web-app/components/CopyToClipboardInput";
import { ResourceSectionRail } from "@/web-app/components/ResourceSectionRail";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { useTableScroll, useWindowedRows } from "@/web-app/hooks/useWindowedRows";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { RegistryLoginDialog } from "@/web-app/screens/Registry/RegistryLoginDialog";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./SecurityScreen.css";
import { imageDisplayName, imageSectionRailItems } from "./Navigation";
import {
  useCosignLogin,
  useCosignLoginState,
  useExportSbom,
  useImage,
  useImageSecurity,
  useImageSignature,
} from "./queries";
import { Donut } from "./SecurityCharts";

export const ID = "image.security";
export const Title = i18n.t("Image Security");

export interface ScreenProps extends AppScreenProps {}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;
type SignatureReport = NonNullable<SecuritySignatureResult["signature"]>;

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
const SEVERITY_LABELS: Record<(typeof SEVERITIES)[number], string> = {
  CRITICAL: i18n.t("Critical"),
  HIGH: i18n.t("High"),
  MEDIUM: i18n.t("Medium"),
  LOW: i18n.t("Low"),
  UNKNOWN: i18n.t("Unknown"),
};
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

// Severity donut colours, aligned to the unified theme's intents (this per-image screen is always unified).
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#f43f5e",
  HIGH: "#fb923c",
  MEDIUM: "#f59e0b",
  LOW: "#64748b",
  UNKNOWN: "#94a3b8",
};
// Categorical palette for the license-distribution donut + legend, cycled. A chart needs a stable colour set.
const LICENSE_PALETTE = [
  "#14b8a6",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#6366f1",
  "#ec4899",
  "#eab308",
  "#06b6d4",
  "#8b5cf6",
  "#f97316",
  "#22d3ee",
  "#84cc16",
  "#f43f5e",
  "#0ea5e9",
];

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

function shouldShowDescriptionToggle(value?: string): boolean {
  return (value?.length ?? 0) > 180;
}

// Column sort for the findings table. `severity` asc = most-severe first (rank asc); every field breaks ties
// by severity then published date so the order is stable.
function sortFindingsBy(findings: SecurityFinding[], sort: { field: string; dir: "asc" | "desc" }): SecurityFinding[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  const rank = (finding: SecurityFinding) => SEVERITY_RANK[finding.vulnerability.Severity] ?? 99;
  const text = (finding: SecurityFinding) => {
    switch (sort.field) {
      case "id":
        return finding.vulnerability.VulnerabilityID || "";
      case "package":
        return finding.vulnerability.PkgName || finding.group.Target || "";
      case "type":
        return finding.group.Type || "";
      default:
        return "";
    }
  };
  return [...findings].sort((a, b) => {
    let delta = 0;
    if (sort.field === "severity") {
      delta = rank(a) - rank(b);
    } else if (sort.field === "published") {
      delta = dayjs(a.vulnerability.Published).valueOf() - dayjs(b.vulnerability.Published).valueOf();
    } else {
      delta = text(a).localeCompare(text(b));
    }
    if (delta !== 0) {
      return mul * delta;
    }
    // Stable tie-break: severity, then newest first.
    return rank(a) - rank(b) || dayjs(b.vulnerability.Published).valueOf() - dayjs(a.vulnerability.Published).valueOf();
  });
}

// Column sort for the SBOM package table — string compare on the chosen field, tie-broken by package name.
function sortSbomBy(packages: SbomPackage[], sort: { field: string; dir: "asc" | "desc" }): SbomPackage[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  const text = (pkg: SbomPackage) => {
    switch (sort.field) {
      case "version":
        return pkg.version || "";
      case "type":
        return pkg.type || "";
      case "license":
        return pkg.license || "";
      default:
        return pkg.name || "";
    }
  };
  return [...packages].sort((a, b) => {
    const delta = text(a).localeCompare(text(b));
    return delta !== 0 ? mul * delta : (a.name || "").localeCompare(b.name || "");
  });
}

function findingKey(group: SecurityReportResultGroup, vulnerability: SecurityVulnerability): string {
  return (
    vulnerability.guid ||
    `${group.Target}:${vulnerability.VulnerabilityID}:${vulnerability.PrimaryURL}:${vulnerability.Published}`
  );
}

function signatureIcon(state: SignatureReport["state"]) {
  if (state === "verified") {
    return IconNames.TICK_CIRCLE;
  }
  return state === "unsigned" ? IconNames.WARNING_SIGN : IconNames.ERROR;
}

function signatureLabel(signature: SignatureReport, t: TranslateFn): string {
  if (signature.state === "verified") {
    return signature.keyless ? t("Verified · keyless") : t("Verified");
  }
  return signature.state === "unsigned" ? t("Not signed") : t("Verification error");
}

// The facts to list under the signature status — identity / issuer / signature kind / Rekor entry.
function signatureRows(
  signature: SignatureReport,
  t: TranslateFn,
): Array<{ label: string; value: string; code?: boolean }> {
  if (signature.state === "verified") {
    const rows: Array<{ label: string; value: string }> = [];
    if (signature.identity) {
      rows.push({ label: t("Signed identity"), value: signature.identity });
    }
    if (signature.issuer) {
      rows.push({ label: t("Issuer (OIDC)"), value: signature.issuer });
    }
    rows.push({
      label: t("Signature"),
      value: signature.keyless ? t("cosign · keyless (sigstore)") : t("cosign · key-based"),
    });
    if (signature.rekorLogIndex) {
      rows.push({ label: t("Transparency log"), value: `Rekor #${signature.rekorLogIndex} · logged` });
    }
    return rows;
  }
  if (signature.state === "unsigned") {
    return [{ label: t("Signature"), value: t("No signature found for this image") }];
  }
  return [
    { label: t("Signature"), value: t("cosign could not verify this image") },
    ...(signature.detail ? [{ label: t("Reason"), value: signature.detail, code: true }] : []),
  ];
}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>(["CRITICAL", "HIGH"]);
  const [expandedDescriptions, setExpandedDescriptions] = useState<string[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  // Column sort for the (virtualized) findings table; severity-first by default, like the entity lists.
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "severity", dir: "asc" });
  // Column sort for the (virtualized) SBOM package table; by package name by default.
  const [sbomSort, setSbomSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "name", dir: "asc" });
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const imageQuery = useImage(connectionId, decodedId);
  const image = imageQuery.data;
  // Local-vs-registry can't be told apart from image metadata (the containerd image store gives local builds a
  // RepoDigest too, and moving an image between registries can drop it), so we don't guess — cosign's own registry
  // query is the only reliable check. We always run it and interpret the outcome. Signature needs a registry
  // reference; the Trivy scan can also fall back to the local id, so dangling/untagged images stay scannable.
  const signatureTarget = image?.FullName || image?.RepoDigests?.[0];
  const scanTarget = image?.FullName || image?.RepoDigests?.[0] || image?.Id;
  const registry = image?.Registry;
  // Signature runs automatically on open (cheap); the Trivy scan is button-triggered.
  const signatureQuery = useImageSignature(connectionId, decodedId, signatureTarget);
  const securityQuery = useImageSecurity(connectionId, decodedId, scanTarget);
  const exportSbom = useExportSbom(connectionId);

  const report: any = securityQuery.data;
  const scanning = securityQuery.isFetching;
  const scanned = !!report && report.status === "success";
  const reportReturned = !!report && !scanning;
  const scannerMissing = reportReturned && !report?.scanner?.path;
  const reportFaulted = reportReturned && !scanned && !scannerMissing;

  const signatureResult = signatureQuery.data;
  const signature = signatureResult?.signature;
  const cosignMissing = !!signatureResult && signatureResult.available === false;

  // An auth-required cosign failure surfaces a sign-in block. The Log in BUTTON only shows when cosign is not yet
  // authenticated to the registry — once signed in we do NOT re-ask; a persistent failure is then an access /
  // existence issue (private or unpublished image), so the block explains that and shows the raw reason instead.
  const authRequired = signature?.state === "error" && !!signature.authRequired;
  const cosignLoginState = useCosignLoginState(connectionId, registry, authRequired);
  const alreadyLoggedIn = cosignLoginState.data?.loggedIn === true;
  const showSignInBlock = authRequired && !!registry;
  const cosignLogin = useCosignLogin(connectionId);

  const counts = report?.counts;
  const sbomPackages: SbomPackage[] = report?.sbom || [];
  const licenseSummary = summarizeSbomLicenses(sbomPackages);

  const filtersActive = selectedSeverities.length > 0;
  const findings = useMemo<SecurityFinding[]>(
    () =>
      (report?.result?.Results || []).flatMap((group: SecurityReportResultGroup) =>
        (group.Vulnerabilities || []).map((vulnerability: SecurityVulnerability) => ({ group, vulnerability })),
      ),
    [report],
  );
  const filteredFindings = useMemo(
    () =>
      filtersActive
        ? findings.filter(({ vulnerability }) => selectedSeverities.includes(vulnerability.Severity))
        : findings,
    [findings, filtersActive, selectedSeverities],
  );
  const sortedFindings = useMemo(() => sortFindingsBy(filteredFindings, sort), [filteredFindings, sort]);
  const totalCount = SEVERITIES.reduce((total, severity) => total + severityCount(counts, severity), 0);

  const toggleSort = useCallback((field: string) => {
    setSort((current) =>
      current.field === field ? { field, dir: current.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" },
    );
  }, []);
  const sortDirection = useCallback((field: string) => (sort.field === field ? sort.dir : undefined), [sort]);

  // Virtualize the findings table exactly like the entity lists (Volumes/Mounts/Secrets) — no grouping here.
  const { scrollElementRef, theadRef, scrollMargin, getScrollElement } = useTableScroll();
  const getFindingRowKey = useCallback(
    (finding: SecurityFinding) => findingKey(finding.group, finding.vulnerability),
    [],
  );
  const { items, paddingTop, paddingBottom, measureRef } = useWindowedRows({
    rows: sortedFindings,
    getScrollElement,
    getRowKey: getFindingRowKey,
    scrollMargin,
    estimateRowHeight: () => 84,
    enabled: scanned,
  });

  // The SBOM inventory is its own virtualized table, using the same scroll/windowing machinery as the findings.
  const sortedSbom = useMemo(() => sortSbomBy(sbomPackages, sbomSort), [sbomPackages, sbomSort]);
  const toggleSbomSort = useCallback((field: string) => {
    setSbomSort((current) =>
      current.field === field ? { field, dir: current.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" },
    );
  }, []);
  const sbomSortDirection = useCallback(
    (field: string) => (sbomSort.field === field ? sbomSort.dir : undefined),
    [sbomSort],
  );
  const {
    scrollElementRef: sbomScrollRef,
    theadRef: sbomTheadRef,
    scrollMargin: sbomScrollMargin,
    getScrollElement: getSbomScrollElement,
  } = useTableScroll();
  const getSbomRowKey = useCallback((pkg: SbomPackage) => `${pkg.name}@${pkg.version}@${pkg.type}`, []);
  const {
    items: sbomItems,
    paddingTop: sbomPaddingTop,
    paddingBottom: sbomPaddingBottom,
    measureRef: sbomMeasureRef,
  } = useWindowedRows({
    rows: sortedSbom,
    getScrollElement: getSbomScrollElement,
    getRowKey: getSbomRowKey,
    scrollMargin: sbomScrollMargin,
    estimateRowHeight: () => 33,
    enabled: scanned && sbomPackages.length > 0,
  });

  // Donut slices for the severity + license distributions (Mend-style).
  const severitySlices = SEVERITIES.map((severity) => ({
    key: severity,
    label: t(SEVERITY_LABELS[severity]),
    value: severityCount(counts, severity),
    color: SEVERITY_COLORS[severity],
  }));
  const licenseSlices = licenseSummary.map((entry, index) => ({
    key: entry.license,
    label: entry.license,
    value: entry.count,
    color: LICENSE_PALETTE[index % LICENSE_PALETTE.length],
  }));

  const pending = imageQuery.isLoading || imageQuery.isFetching;

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

  const runScan = () => {
    securityQuery.refetch();
  };

  const onExport = async (format: string) => {
    if (!scanTarget || !image) {
      return;
    }
    const { content } = await exportSbom.mutateAsync({ format, target: scanTarget });
    const extension = format.startsWith("cyclonedx") ? "cdx.json" : "spdx.json";
    const base = imageDisplayName(image).replace(/[^a-z0-9._-]+/gi, "_");
    saveAs(new Blob([content], { type: "application/json" }), `${base}.sbom.${extension}`);
  };

  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const repoDigest = image.RepoDigests?.[0] || "";
  const digest = repoDigest.includes("@") ? repoDigest.split("@")[1] : image.Digest || "";
  const fullRef = image.FullName || imageDisplayName(image);
  const tagLabel = image.Tag ? `${image.Name}:${image.Tag}` : image.RepoTags?.[0] || imageDisplayName(image);

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <ResourceSectionRail items={imageSectionRailItems(image.Id, connectionId)} activeId={ID} dataScreen={ID}>
        <div className="AppScreenContent SecurityContent">
          {/* Identity + digest — available instantly from manifest metadata, no scan required. */}
          <div className="SecurityIdentity">
            <Icon icon={IconNames.BOX} className="SecurityIdentityIcon" />
            <span className="SecurityMono SecurityIdentityRef">{fullRef}</span>
            {digest ? (
              <CopyToClipboardInput className="SecurityDigestField" value={digest} title={t("Image digest")} />
            ) : (
              <span className="SecuritySpacer" />
            )}
            {registry ? (
              <div className="SecurityIdentityRegistry">
                <Icon icon={IconNames.GLOBE_NETWORK} />
                <div className="SecurityIdentityRegistryText">
                  <span className="SecurityIdentityRegistryLabel">{t("Registry")}</span>
                  <span className="SecurityMono SecurityIdentityRegistryValue">{registry}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="SecurityGrid2">
            {/* Signature & provenance (cosign) — verified on open. */}
            <section className="SecurityPanel">
              <h5 className="SecurityPanelTitle">
                <Icon icon={IconNames.ENDORSED} />
                <span>{t("Signature & provenance")}</span>
                <span className="SecurityPanelHint">cosign</span>
                <Button
                  className="SecurityPanelScan"
                  intent={Intent.PRIMARY}
                  icon={IconNames.REFRESH}
                  text={t("Recheck")}
                  onClick={() => signatureQuery.refetch()}
                  loading={signatureQuery.isFetching}
                  disabled={signatureQuery.isFetching || !signatureTarget}
                />
              </h5>
              <div className="SecurityPanelBody">
                {cosignMissing ? (
                  <NonIdealState
                    icon={IconNames.ENDORSED}
                    title={t("cosign is not installed")}
                    description={<p>{t("Install cosign to verify image signatures and provenance.")}</p>}
                  />
                ) : signature ? (
                  showSignInBlock ? (
                    <div className="SecuritySignIn">
                      <div className="SecurityStatusLine" data-signature={alreadyLoggedIn ? "error" : "unsigned"}>
                        <Icon icon={alreadyLoggedIn ? IconNames.ERROR : IconNames.LOCK} />
                        <span>{alreadyLoggedIn ? t("Couldn't read this image") : t("Sign in to verify")}</span>
                      </div>
                      <p className="SecurityMuted SecuritySignInText">
                        {alreadyLoggedIn
                          ? t(
                              "cosign is signed in to {{registry}} but couldn't read this image — it may be private (no access) or not published to that registry (e.g. a local build).",
                              { registry },
                            )
                          : t(
                              "{{registry}} requires sign-in before this image's manifest and signature can be read. Sign in and verification resumes automatically.",
                              { registry },
                            )}
                      </p>
                      {alreadyLoggedIn ? null : (
                        <Button
                          className="SecuritySignInButton"
                          intent={Intent.PRIMARY}
                          icon={IconNames.LOG_IN}
                          text={t("Log in to {{registry}}", { registry })}
                          loading={cosignLogin.isPending}
                          onClick={() => setLoginOpen(true)}
                        />
                      )}
                      {alreadyLoggedIn && signature.detail ? (
                        <pre className="SecurityCodeBlock">{signature.detail}</pre>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="SecurityStatusLine" data-signature={signature.state}>
                        <Icon icon={signatureIcon(signature.state)} />
                        <span>{signatureLabel(signature, t)}</span>
                      </div>
                      <dl className="SecurityKv">
                        {signatureRows(signature, t).map((row) =>
                          row.code ? (
                            <div className="SecurityKvRow" data-align="top" key={row.label}>
                              <dt>{row.label}</dt>
                              <dd>
                                <pre className="SecurityCodeBlock">{row.value}</pre>
                              </dd>
                            </div>
                          ) : (
                            <div className="SecurityKvRow" key={row.label}>
                              <dt>{row.label}</dt>
                              <dd className="SecurityMono">{row.value}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </>
                  )
                ) : signatureQuery.isFetching ? null : (
                  <div className="SecurityMuted">{t("No signature information.")}</div>
                )}
              </div>
            </section>

            {/* Digest — content-addressed identity; primary action is Copy digest. */}
            <section className="SecurityPanel">
              <h5 className="SecurityPanelTitle">
                <Icon icon={IconNames.PIN} />
                <span>{t("Digest")}</span>
              </h5>
              <div className="SecurityPanelBody">
                <div className="SecurityStatusLine" data-signature={digest ? "verified" : "unsigned"}>
                  <Icon icon={digest ? IconNames.CONFIRM : IconNames.WARNING_SIGN} />
                  <span>{digest ? t("Content-addressed by digest") : t("No digest recorded")}</span>
                </div>
                <dl className="SecurityKv">
                  <div className="SecurityKvRow">
                    <dt>{t("Tag")}</dt>
                    <dd className="SecurityMono">{tagLabel}</dd>
                  </div>
                  <div className="SecurityKvRow">
                    <dt>{t("Resolves to")}</dt>
                    <dd>
                      {digest ? (
                        <CopyToClipboardInput value={digest} title={t("Image digest")} />
                      ) : (
                        <span className="SecurityMono">—</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="SecurityMuted SecurityNote">
                  {t("Reference this digest to use exactly this image and prevent supply chain attacks.")}
                </p>
              </div>
            </section>
          </div>

          {/* Vulnerabilities (Trivy) — gated behind the Scan button. */}
          <section className="SecurityPanel">
            <h5 className="SecurityPanelTitle">
              <Icon icon={IconNames.SHIELD} />
              <span>{t("Vulnerabilities")}</span>
              <span className="SecurityPanelHint">Trivy</span>
              <Button
                className="SecurityPanelScan"
                intent={Intent.PRIMARY}
                icon={IconNames.SEARCH_TEMPLATE}
                text={scanned ? t("Rescan") : t("Scan for vulnerabilities")}
                onClick={runScan}
                loading={scanning}
                disabled={scanning || !scanTarget}
              />
            </h5>
            <div className="SecurityPanelBody">
              {scannerMissing ? (
                <NonIdealState
                  icon={IconNames.SHIELD}
                  title={t("Vulnerability scanning is unavailable")}
                  description={<p>{t("Please install trivy and then rescan")}</p>}
                />
              ) : reportFaulted ? (
                <NonIdealState
                  icon={IconNames.WARNING_SIGN}
                  title={t("Report could not be generated")}
                  description={<p>{t("An internal error occurred, please report the issue.")}</p>}
                />
              ) : scanned ? (
                <div className="SecurityVulnLayout">
                  <div className="SecurityVulnAside">
                    <Donut
                      slices={severitySlices}
                      centerValue={totalCount}
                      centerLabel={t("findings")}
                      size={172}
                      showEmptyTrack
                    />
                    <div className="SecuritySeverityFilters">
                      {SEVERITIES.map((severity) => {
                        const active = selectedSeverities.includes(severity);
                        const count = severityCount(counts, severity);
                        return (
                          <Switch
                            key={severity}
                            className="SecuritySeverityFilter"
                            checked={active}
                            onChange={() => toggleSeverityFilter(severity)}
                            aria-label={t("Filter by {{severity}}", { severity: t(SEVERITY_LABELS[severity]) })}
                            labelElement={
                              <span className="SecuritySeverityFilterLabel" data-empty={count === 0 ? "yes" : "no"}>
                                <span className="SecuritySeverityCountPill" data-severity={severity}>
                                  {count}
                                </span>
                                <span className="SecuritySeverityFilterText">{t(SEVERITY_LABELS[severity])}</span>
                              </span>
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="SecurityFindingsScroll" ref={scrollElementRef}>
                    <HTMLTable
                      compact
                      interactive
                      className="AppDataTable SecurityFindingsTable"
                      data-windowed="true"
                      data-table="image.scanning.report"
                    >
                      <colgroup>
                        <col className="SecurityColumnSeverity" />
                        <col className="SecurityColumnVulnerability" />
                        <col className="SecurityColumnTarget" />
                        <col className="SecurityColumnType" />
                        <col className="SecurityColumnPublished" />
                      </colgroup>
                      <thead ref={theadRef}>
                        <tr>
                          <SortableColumnHeader
                            field="severity"
                            direction={sortDirection("severity")}
                            onSort={toggleSort}
                          >
                            {t("Severity")}
                          </SortableColumnHeader>
                          <SortableColumnHeader field="id" direction={sortDirection("id")} onSort={toggleSort}>
                            {t("Vulnerability ID")}
                          </SortableColumnHeader>
                          <SortableColumnHeader
                            field="package"
                            direction={sortDirection("package")}
                            onSort={toggleSort}
                          >
                            {t("Package / Target")}
                          </SortableColumnHeader>
                          <SortableColumnHeader field="type" direction={sortDirection("type")} onSort={toggleSort}>
                            {t("Type")}
                          </SortableColumnHeader>
                          <SortableColumnHeader
                            field="published"
                            direction={sortDirection("published")}
                            onSort={toggleSort}
                          >
                            {t("Published")}
                          </SortableColumnHeader>
                        </tr>
                      </thead>
                      <tbody>
                        <VirtualSpacerRow height={paddingTop} columnCount={5} />
                        {items.map(({ row: { group, vulnerability }, index, key }) => {
                          const expanded = expandedDescriptions.includes(key);
                          const description = vulnerability.Description || "";
                          const canToggleDescription = shouldShowDescriptionToggle(description);
                          const pkgLabel = vulnerability.PkgName
                            ? `${vulnerability.PkgName}${vulnerability.InstalledVersion ? ` ${vulnerability.InstalledVersion}` : ""}`
                            : group.Target;
                          const striped = index % 2 === 0 ? "true" : undefined;
                          return (
                            <tr
                              key={key}
                              ref={measureRef}
                              data-index={index}
                              data-striped={striped}
                              data-severity={vulnerability.Severity}
                            >
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
                                <span className="SecurityFindingTarget">{pkgLabel}</span>
                                <span className="SecurityFindingMeta">{group.Target}</span>
                              </td>
                              <td className="SecurityCellType">{group.Type}</td>
                              <td className="SecurityCellPublished">{formatPublishedDate(vulnerability.Published)}</td>
                            </tr>
                          );
                        })}
                        <VirtualSpacerRow height={paddingBottom} columnCount={5} />
                        {sortedFindings.length === 0 ? (
                          <tr className="SecurityFindingsEmptyRow">
                            <td colSpan={5}>
                              <div className="SecurityFindingsEmpty">
                                <Icon
                                  icon={findings.length === 0 ? IconNames.TICK_CIRCLE : IconNames.FILTER}
                                  size={26}
                                />
                                <span>
                                  {findings.length === 0
                                    ? t("No vulnerabilities found")
                                    : t("No vulnerabilities match the selected severities")}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </HTMLTable>
                  </div>
                </div>
              ) : (
                <div className="SecurityRunPrompt">
                  <Icon icon={IconNames.HELP} size={22} className="SecurityRunPromptIcon" />
                  <div className="SecurityRunPromptText">
                    <b>{scanning ? t("Scanning…") : t("Not scanned yet")}</b>
                    <div className="SecurityMuted">
                      {scanning
                        ? t("Running a local scan of vulnerabilities…")
                        : t("Run a local scan of vulnerabilities to get detailed summary.")}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {scanned ? (
              <div className="SecurityPanelFooter">
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
              </div>
            ) : null}
          </section>

          {/* SBOM (Trivy output) — the full package inventory as a virtualized table; export lives in the header. */}
          <section className="SecurityPanel">
            <h5 className="SecurityPanelTitle">
              <Icon icon={IconNames.DIAGRAM_TREE} />
              <span>{t("SBOM")}</span>
              <span className="SecurityPanelHint">Trivy · SPDX / CycloneDX</span>
              {scanned && sbomPackages.length ? (
                <ButtonGroup className="SecuritySbomExport" variant="outlined">
                  <Button
                    icon={IconNames.EXPORT}
                    text={t("Export SPDX")}
                    onClick={() => onExport("spdx-json")}
                    disabled={exportSbom.isPending}
                    size="small"
                  />
                  <Button
                    icon={IconNames.EXPORT}
                    text={t("Export CycloneDX")}
                    onClick={() => onExport("cyclonedx")}
                    disabled={exportSbom.isPending}
                    size="small"
                  />
                </ButtonGroup>
              ) : null}
            </h5>
            <div className="SecurityPanelBody">
              {scanned && sbomPackages.length ? (
                <div className="SecurityFindingsScroll" ref={sbomScrollRef}>
                  <HTMLTable
                    compact
                    interactive
                    className="AppDataTable SecuritySbomTable"
                    data-windowed="true"
                    data-table="image.sbom.packages"
                  >
                    <colgroup>
                      <col className="SecuritySbomColumnName" />
                      <col className="SecuritySbomColumnVersion" />
                      <col className="SecuritySbomColumnType" />
                      <col className="SecuritySbomColumnLicense" />
                    </colgroup>
                    <thead ref={sbomTheadRef}>
                      <tr>
                        <SortableColumnHeader
                          field="name"
                          direction={sbomSortDirection("name")}
                          onSort={toggleSbomSort}
                        >
                          {t("Package")}
                        </SortableColumnHeader>
                        <SortableColumnHeader
                          field="version"
                          direction={sbomSortDirection("version")}
                          onSort={toggleSbomSort}
                        >
                          {t("Version")}
                        </SortableColumnHeader>
                        <SortableColumnHeader
                          field="type"
                          direction={sbomSortDirection("type")}
                          onSort={toggleSbomSort}
                        >
                          {t("Type")}
                        </SortableColumnHeader>
                        <SortableColumnHeader
                          field="license"
                          direction={sbomSortDirection("license")}
                          onSort={toggleSbomSort}
                        >
                          {t("License")}
                        </SortableColumnHeader>
                      </tr>
                    </thead>
                    <tbody>
                      <VirtualSpacerRow height={sbomPaddingTop} columnCount={4} />
                      {sbomItems.map(({ row: pkg, index, key }) => {
                        const striped = index % 2 === 0 ? "true" : undefined;
                        return (
                          <tr key={key} ref={sbomMeasureRef} data-index={index} data-striped={striped}>
                            <td className="SecuritySbomCellName SecurityMono">{pkg.name}</td>
                            <td className="SecuritySbomCellVersion SecurityMono">{pkg.version}</td>
                            <td className="SecuritySbomCellType">{pkg.type}</td>
                            <td className="SecuritySbomCellLicense">{pkg.license || "—"}</td>
                          </tr>
                        );
                      })}
                      <VirtualSpacerRow height={sbomPaddingBottom} columnCount={4} />
                    </tbody>
                  </HTMLTable>
                </div>
              ) : (
                <div className="SecurityRunPrompt">
                  <Icon icon={IconNames.DIAGRAM_TREE} size={22} className="SecurityRunPromptIcon" />
                  <div className="SecurityRunPromptText">
                    <b>{t("Generated with the scan")}</b>
                    <div className="SecurityMuted">{t("The Trivy pass emits the SBOM after scan")}</div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Licenses — the SBOM's license-type breakdown, in its own panel. */}
          <section className="SecurityPanel">
            <h5 className="SecurityPanelTitle">
              <Icon icon={IconNames.PIE_CHART} />
              <span>{t("Licenses")}</span>
              <span className="SecurityPanelHint">Trivy</span>
            </h5>
            <div className="SecurityPanelBody">
              {scanned && licenseSlices.length ? (
                <div className="SecurityLicenseDist">
                  <Donut
                    slices={licenseSlices}
                    centerValue={licenseSlices.length}
                    centerLabel={t("license types")}
                    size={172}
                  />
                  <div className="SecurityLicenseLegend">
                    {licenseSlices.map((slice) => (
                      <div className="SecurityLicenseLegendItem" key={slice.key}>
                        <span className="SecurityLicenseSwatch" style={{ background: slice.color }} />
                        <span className="SecurityLicenseName" title={slice.label}>
                          {slice.label}
                        </span>
                        <span className="SecurityLicenseCount">×{slice.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="SecurityRunPrompt">
                  <Icon icon={IconNames.PIE_CHART} size={22} className="SecurityRunPromptIcon" />
                  <div className="SecurityRunPromptText">
                    <b>{t("License breakdown")}</b>
                    <div className="SecurityMuted">{t("Summarized from the SBOM after a scan")}</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </ResourceSectionRail>
      {loginOpen && registry ? (
        <RegistryLoginDialog
          registry={registry}
          connectionId={connectionId}
          onClose={() => setLoginOpen(false)}
          onSubmit={async (auth, secret) => {
            try {
              await cosignLogin.mutateAsync({ registry, username: auth.account ?? "", secret });
              setLoginOpen(false);
              await cosignLoginState.refetch();
              signatureQuery.refetch();
            } catch {
              // Keep the drawer open so the user can fix credentials; the failure shows in the Activity log.
            }
          }}
        />
      ) : null}
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

import {
  Button,
  Icon,
  type IconName,
  InputGroup,
  Intent,
  Menu,
  MenuDivider,
  MenuItem,
  NonIdealState,
  PopoverNext,
  Tag,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  containerNetworks,
  extractPublishedPorts,
  type PublishedPort,
  type ReachabilityCheckType,
  type ReachabilityReport,
  type ReachabilityTone,
} from "@/container-client/reachability/model";
import { RESOURCE_SYNC } from "@/container-client/resourceSyncProtocol";
import type { Container } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { CopyButton } from "@/web-app/components/CopyButton";
import { EngineCell } from "@/web-app/components/EngineCell";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { type MergedResource, mergedKey, useMergedResources } from "@/web-app/hooks/useMergedResources";
import { Notification } from "@/web-app/Notification";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeaderSectionsTabBar } from "../ScreenHeader";
import { ChainPipe } from "./ChainPipe";
import "./Reachability.css";

export const ID = "networks.reachability";
export const Title = "Reachability";

export interface ScreenProps extends AppScreenProps {}

// One selectable target in the query bar. Containers are merged across every connection, so the picked target
// determines the connection the trace runs against (shown in the query hint) — there is NO screen-level scoper.
interface Pickable {
  key: string;
  id: string;
  connectionId: string;
  connectionName: string;
  engine: string;
  name: string;
  ports: PublishedPort[];
  networks: string[];
  running: boolean;
}

interface PickableGroup {
  connectionId: string;
  connectionName: string;
  items: Pickable[];
}

const CHECK_TABS: { id: ReachabilityCheckType; label: string; icon: IconName }[] = [
  { id: "published-port", label: "Published port", icon: IconNames.IMPORT },
  { id: "service-to-service", label: "Service → service", icon: IconNames.EXCHANGE },
  { id: "reach-out", label: "Reach out", icon: IconNames.GLOBE },
  { id: "dns-lookup", label: "DNS lookup", icon: IconNames.SEARCH_TEMPLATE },
];

const containerDisplayName = (container: Container): string => {
  const raw = container?.Computed?.Name || container?.Name || container?.Names?.[0] || container?.Id || "container";
  return `${raw}`.replace(/^\//, "");
};

const isRunning = (container: Container): boolean =>
  `${container?.Computed?.DecodedState ?? container?.State ?? ""}`.toLowerCase().includes("run");

// Map a reachability tone to a Blueprint intent so badges/tags use the framework's own colors.
const toneIntent = (tone: ReachabilityTone): Intent =>
  tone === "ok" ? Intent.SUCCESS : tone === "warn" ? Intent.WARNING : Intent.DANGER;

// Render a string with markdown backtick spans as inline <code> (headlines/explanations carry them).
function CodeText({ text }: { text: string }) {
  // Split on backticks; odd segments are `code`. Key by the segment's byte offset (stable + unique) so we never
  // key by array index (the text is static, but Biome forbids index keys).
  const segments: { key: string; code: boolean; value: string }[] = [];
  let offset = 0;
  text.split("`").forEach((part, index) => {
    segments.push({ key: `s${offset}`, code: index % 2 === 1, value: part });
    offset += part.length + 1;
  });
  return (
    <>
      {segments.map((segment) =>
        segment.code ? (
          <code key={segment.key}>{segment.value}</code>
        ) : (
          <Fragment key={segment.key}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}

function ContainerChip({
  label,
  value,
  groups,
  onSelect,
}: {
  label: string;
  value?: Pickable;
  groups: PickableGroup[];
  onSelect: (pickable: Pickable) => void;
}) {
  const { t } = useTranslation();
  return (
    <PopoverNext
      placement="bottom-start"
      content={
        <Menu className="ReachabilityPickerMenu">
          {groups.map((group) => (
            <Fragment key={group.connectionId}>
              <MenuDivider title={group.connectionName} />
              {group.items.map((item) => (
                <MenuItem
                  key={item.key}
                  active={value?.key === item.key}
                  icon={<EngineCell engine={item.engine} connectionName={item.connectionName} />}
                  text={item.name}
                  labelElement={item.running ? undefined : <span className="muted">{t("stopped")}</span>}
                  onClick={() => onSelect(item)}
                />
              ))}
            </Fragment>
          ))}
        </Menu>
      }
    >
      <button type="button" className="qchip qchipButton">
        <span className="lbl">{label}</span>
        {value ? (
          <>
            <EngineCell engine={value.engine} connectionName={value.connectionName} />
            <span className="qchipName">{value.name}</span>
          </>
        ) : (
          <span className="muted">{t("select…")}</span>
        )}
        <Icon icon={IconNames.CARET_DOWN} />
      </button>
    </PopoverNext>
  );
}

const formatPort = (port: PublishedPort): string => `${port.hostPort} → ${port.containerPort}/${port.protocol}`;

// The published-port picker — same dropdown chip idiom as ContainerChip (single caret), so it lines up with the
// FROM/CONTAINER chips instead of a mismatched native <select>.
function PortChip({
  ports,
  index,
  onSelect,
}: {
  ports: PublishedPort[];
  index: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (!ports.length) {
    return (
      <span className="qchip">
        <span className="lbl">{t("port")}</span>
        <span className="muted">{t("no published ports")}</span>
      </span>
    );
  }
  const active = ports[index] ?? ports[0];
  return (
    <PopoverNext
      placement="bottom-start"
      content={
        <Menu className="ReachabilityPickerMenu">
          {ports.map((port, portIdx) => (
            <MenuItem
              key={`${port.hostIp}:${port.hostPort}-${port.containerPort}/${port.protocol}`}
              active={portIdx === index}
              text={formatPort(port)}
              onClick={() => onSelect(portIdx)}
            />
          ))}
        </Menu>
      }
    >
      <button type="button" className="qchip qchipButton">
        <span className="lbl">{t("port")}</span>
        <span className="qchipName">{formatPort(active)}</span>
        <Icon icon={IconNames.CARET_DOWN} />
      </button>
    </PopoverNext>
  );
}

// Reachability debugger — GLOBAL "why can't I reach it?" troubleshooter reached via the Networks navbar tab
// navigator (not a sidebar entry). You frame ONE question (published port · service→service · reach out · DNS
// lookup) against a target picked from every connection's merged containers, then Test reachability runs a
// transport-aware trace (ChainPipe), pinpoints where it dies, and hands back a plain-language cause + copyable
// fix. The probe (window.MessageBus → RESOURCE_SYNC.probeReachability) is assembled by the main-process prober;
// this screen owns the query + renders the returned report. Mirrors the Volumes→Mounts sub-screen shell.
export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const containers = useMergedResources("containers") as MergedResource<Container>[];
  const [checkType, setCheckType] = useState<ReachabilityCheckType>("published-port");
  const [fromKey, setFromKey] = useState<string>("");
  const [targetKey, setTargetKey] = useState<string>("");
  const [portIndex, setPortIndex] = useState(0);
  const [servicePort, setServicePort] = useState("80");
  const [externalHost, setExternalHost] = useState("api.github.com");
  const [externalPort, setExternalPort] = useState("443");
  const [lookupName, setLookupName] = useState("host.docker.internal");
  const [report, setReport] = useState<ReachabilityReport | null>(null);
  const [running, setRunning] = useState(false);

  const pickables = useMemo<Pickable[]>(
    () =>
      containers.map((container) => ({
        key: mergedKey(container, container.Id),
        id: `${container.Id}`,
        connectionId: container.connectionId,
        connectionName: container.connectionName,
        engine: `${container.engine}`,
        name: containerDisplayName(container),
        ports: extractPublishedPorts(container),
        networks: containerNetworks(container),
        running: isRunning(container),
      })),
    [containers],
  );
  const byKey = useMemo(() => new Map(pickables.map((item) => [item.key, item])), [pickables]);
  const groups = useMemo<PickableGroup[]>(() => {
    const byConnection = new Map<string, PickableGroup>();
    for (const item of pickables) {
      let group = byConnection.get(item.connectionId);
      if (!group) {
        group = { connectionId: item.connectionId, connectionName: item.connectionName, items: [] };
        byConnection.set(item.connectionId, group);
      }
      group.items.push(item);
    }
    return [...byConnection.values()];
  }, [pickables]);

  // Seed sensible defaults once containers arrive (a target with published ports leads to a working trace).
  useEffect(() => {
    if (!pickables.length) {
      return;
    }
    setFromKey((prev) => (prev && byKey.has(prev) ? prev : pickables[0].key));
    setTargetKey((prev) => {
      if (prev && byKey.has(prev)) {
        return prev;
      }
      return (pickables.find((item) => item.ports.length) ?? pickables[0]).key;
    });
  }, [byKey, pickables]);

  const fromPick = byKey.get(fromKey);
  const targetPick = byKey.get(targetKey);
  const targetPorts = targetPick?.ports ?? [];
  const activePort = targetPorts[portIndex] ?? targetPorts[0];
  // The service picker (service→service) is scoped to the FROM container's connection — engine DNS only resolves
  // container names within the same connection's networks.
  const serviceGroups = fromPick ? groups.filter((group) => group.connectionId === fromPick.connectionId) : groups;

  const request = useMemo(() => {
    switch (checkType) {
      case "published-port": {
        if (!targetPick) {
          return null;
        }
        return {
          connectionId: targetPick.connectionId,
          checkType,
          targetContainerId: targetPick.id,
          hostPort: activePort?.hostPort,
          containerPort: activePort?.containerPort,
          protocol: activePort?.protocol,
        };
      }
      case "service-to-service": {
        if (!fromPick) {
          return null;
        }
        const svcTarget = targetPick && targetPick.connectionId === fromPick.connectionId ? targetPick : undefined;
        const service = svcTarget?.name;
        if (!service) {
          return null;
        }
        return {
          connectionId: fromPick.connectionId,
          checkType,
          fromContainerId: fromPick.id,
          targetContainerId: svcTarget?.id,
          serviceName: service,
          containerPort: Number(servicePort) || 80,
        };
      }
      case "reach-out": {
        if (!fromPick || !externalHost.trim()) {
          return null;
        }
        return {
          connectionId: fromPick.connectionId,
          checkType,
          fromContainerId: fromPick.id,
          externalHost: externalHost.trim(),
          externalPort: Number(externalPort) || 443,
        };
      }
      case "dns-lookup": {
        if (!fromPick || !lookupName.trim()) {
          return null;
        }
        return {
          connectionId: fromPick.connectionId,
          checkType,
          fromContainerId: fromPick.id,
          lookupName: lookupName.trim(),
        };
      }
      default:
        return null;
    }
  }, [activePort, checkType, externalHost, externalPort, fromPick, lookupName, servicePort, targetPick]);

  const runProbe = useCallback(async () => {
    if (!request) {
      return;
    }
    setRunning(true);
    try {
      const result = (await window.MessageBus.invoke(RESOURCE_SYNC.probeReachability, request)) as ReachabilityReport;
      setReport(result);
    } catch (error: any) {
      Notification.show({
        message: t("Reachability probe failed: {{message}}", { message: error?.message ?? `${error}` }),
        intent: Intent.DANGER,
      });
    } finally {
      setRunning(false);
    }
  }, [request, t]);

  const openHref = useCallback((href?: string) => {
    if (href) {
      window.open(href, "_blank", "noopener");
    }
  }, []);

  const connectionHint = fromPick || targetPick;
  const diagnosis = report?.diagnosis;
  const remoteLabel = report?.remoteLabel;

  return (
    <div className="AppScreen Reachability" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        titleIcon={IconNames.GLOBE_NETWORK}
        rightContent={
          <ResourceListActions
            actions={{
              disabled: !request || running,
              icon: IconNames.LIGHTNING,
              intent: Intent.PRIMARY,
              loading: running,
              text: t("Test reachability"),
              title: t("Trace the path for this question and diagnose where it fails"),
              onClick: runProbe,
            }}
            navigation={<ScreenHeaderSectionsTabBar isActive={(screen) => screen === ID} />}
            onReload={runProbe}
          />
        }
      >
        <div className="checkTabs">
          {CHECK_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === checkType ? "ct active" : "ct"}
              onClick={() => setCheckType(tab.id)}
            >
              <Icon icon={tab.icon} />
              {t(tab.label)}
            </button>
          ))}
        </div>
      </AppScreenHeader>
      <div className="AppScreenContent">
        <section className="Card ReachabilityQuery">
          <div className="qexpr">
            {checkType === "published-port" ? (
              <>
                <span className="qchip">
                  <span className="lbl">{t("from")}</span>
                  <Icon icon={IconNames.DESKTOP} />
                  {t("Host")}
                </span>
                <span className="qarrow">→</span>
                <ContainerChip
                  label={t("container")}
                  value={targetPick}
                  groups={groups}
                  onSelect={(item) => {
                    setTargetKey(item.key);
                    setPortIndex(0);
                  }}
                />
                <PortChip ports={targetPorts} index={portIndex} onSelect={setPortIndex} />
              </>
            ) : null}
            {checkType === "service-to-service" ? (
              <>
                <ContainerChip
                  label={t("from")}
                  value={fromPick}
                  groups={groups}
                  onSelect={(item) => setFromKey(item.key)}
                />
                <span className="qarrow">→</span>
                <ContainerChip
                  label={t("service")}
                  value={targetPick && targetPick.connectionId === fromPick?.connectionId ? targetPick : undefined}
                  groups={serviceGroups}
                  onSelect={(item) => setTargetKey(item.key)}
                />
                <span className="qchip qchipInput qchipPort">
                  <span className="lbl">{t("port")}</span>
                  <InputGroup
                    size="small"
                    value={servicePort}
                    onChange={(event) => setServicePort(event.currentTarget.value)}
                  />
                </span>
              </>
            ) : null}
            {checkType === "reach-out" ? (
              <>
                <ContainerChip
                  label={t("from")}
                  value={fromPick}
                  groups={groups}
                  onSelect={(item) => setFromKey(item.key)}
                />
                <span className="qarrow">→</span>
                <span className="qchip qchipInput qchipWide">
                  <span className="lbl">{t("host / URL")}</span>
                  <InputGroup
                    size="small"
                    value={externalHost}
                    onChange={(event) => setExternalHost(event.currentTarget.value)}
                  />
                </span>
                <span className="qchip qchipInput qchipPort">
                  <span className="lbl">{t("port")}</span>
                  <InputGroup
                    size="small"
                    value={externalPort}
                    onChange={(event) => setExternalPort(event.currentTarget.value)}
                  />
                </span>
              </>
            ) : null}
            {checkType === "dns-lookup" ? (
              <>
                <ContainerChip
                  label={t("from")}
                  value={fromPick}
                  groups={groups}
                  onSelect={(item) => setFromKey(item.key)}
                />
                <span className="qchip qchipInput qchipWide">
                  <span className="lbl">{t("name")}</span>
                  <InputGroup
                    size="small"
                    value={lookupName}
                    onChange={(event) => setLookupName(event.currentTarget.value)}
                  />
                </span>
              </>
            ) : null}
          </div>
          {connectionHint ? null : <div className="qhint">{t("No connected containers to trace against.")}</div>}
        </section>

        {report ? (
          <>
            <section className="Card ReachabilityTrace">
              <div className="traceHead">
                <div className="lt">
                  <h5>{t("Path")}</h5>
                  <span className="muted">{report.pathLabel}</span>
                </div>
                <Tag className="verdictTag" round minimal intent={toneIntent(report.verdict.tone)}>
                  {report.verdict.text}
                </Tag>
              </div>
              <ChainPipe hops={report.hops} remoteLabel={remoteLabel} />
            </section>

            {diagnosis ? (
              <div className={`Diagnosis ${diagnosis.tone}`}>
                <div className="dico">
                  <Icon icon={diagnosis.icon as IconName} />
                </div>
                <div className="dbody">
                  <h5>
                    <CodeText text={diagnosis.headline} />
                  </h5>
                  <p>
                    <CodeText text={diagnosis.explanation} />
                  </p>
                  {diagnosis.fixCommand ? (
                    <div className="fixcmd">
                      <span className="cmd">{diagnosis.fixCommand}</span>
                      <CopyButton text={diagnosis.fixCommand} title={t("Copy fix command")} />
                    </div>
                  ) : null}
                  {diagnosis.actions.some((action) => action.href) ? (
                    <div className="fixrow">
                      {diagnosis.actions
                        .filter((action) => action.href)
                        .map((action) => (
                          <Button
                            key={action.id}
                            size="small"
                            variant="minimal"
                            icon={action.icon as IconName}
                            text={action.text}
                            onClick={() => openHref(action.href)}
                          />
                        ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <section className="Card ReachabilityProbes">
              <div className="CardHead">
                <h5>{t("What I checked")}</h5>
                <span className="muted">{report.probeSummary}</span>
              </div>
              <table className="AppDataTable">
                <thead>
                  <tr>
                    <th className="probeCol" />
                    <th>{t("Probe")}</th>
                    <th>{t("Result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.probes.map((probe) => (
                    <tr
                      key={probe.id}
                      className={probe.smoking ? `smoking ${probe.smoking === "warn" ? "w" : ""}` : undefined}
                    >
                      <td className="probeCol">
                        <span
                          className={`dot ${probe.state === "err" ? "err" : probe.state === "warn" ? "warn" : "ok"}`}
                        />
                      </td>
                      <td className="pcmd">{probe.command}</td>
                      <td className={`presult ${probe.state}`}>{probe.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : (
          <NonIdealState
            icon={IconNames.GLOBE_NETWORK}
            title={t("Frame a question")}
            description={
              <p>{t("Pick a target above, then Test reachability to trace the path and diagnose where it fails.")}</p>
            }
          />
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/networks/reachability",
};
Screen.Metadata = {
  LeftIcon: IconNames.GLOBE_NETWORK,
  ExcludeFromSidebar: true,
};

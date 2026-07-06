import {
  AnchorButton,
  Button,
  ButtonGroup,
  Divider,
  HTMLTable,
  Intent,
  Menu,
  MenuItem,
  NonIdealState,
  PopoverNext,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, SwarmConfig, SwarmNode, SwarmSecret, SwarmService, SwarmStack } from "@/env/Types";
import { extractApiErrorText } from "@/utils/apiError";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { ConfirmMenu, ConfirmMenuItem } from "@/web-app/components/ConfirmMenu";
import { ConnectionSelect, connectedConnections, isDockerConnection } from "@/web-app/components/ConnectionSelect";
import { useRouteSearch } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { InitializeDrawer } from "./InitializeDrawer";
import { getSwarmInspectUrl, getSwarmTabUrl, type SwarmTab } from "./Navigation";
import {
  useRemoveNode,
  useRemoveService,
  useRemoveSwarmConfig,
  useRemoveSwarmSecret,
  useScaleService,
  useSwarmConfigs,
  useSwarmInfo,
  useSwarmLeave,
  useSwarmNodes,
  useSwarmSecrets,
  useSwarmServices,
  useSwarmStacks,
  useUpdateNode,
} from "./queries";

import "./ManageScreen.css";

export const ID = "swarm";
export interface ScreenProps extends AppScreenProps {}

const TABS: SwarmTab[] = ["services", "nodes", "stacks", "secrets", "configs"];
const TAB_LABELS: Record<SwarmTab, string> = {
  services: "Services",
  nodes: "Nodes",
  stacks: "Stacks",
  secrets: "Secrets",
  configs: "Configs",
};

const serviceReplicas = (service: SwarmService): string => {
  if (service.Spec?.Mode?.Global) {
    return "global";
  }
  return `${service.Spec?.Mode?.Replicated?.Replicas ?? 0}`;
};

const servicePorts = (service: SwarmService): string => {
  const ports = service.Endpoint?.Ports ?? [];
  if (ports.length === 0) {
    return "—";
  }
  return ports.map((p) => `${p.PublishedPort ?? ""}:${p.TargetPort ?? ""}/${p.Protocol ?? "tcp"}`).join(", ");
};

const nameMatches = (term: string) => {
  const query = term.toLowerCase();
  return (name?: string) => !query || (name ?? "").toLowerCase().includes(query);
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { tab: tabParam } = useRouteSearch<{ tab?: SwarmTab; connId?: string }>();
  const tab: SwarmTab = TABS.includes(tabParam as SwarmTab) ? (tabParam as SwarmTab) : "services";

  // The app can hold several Docker connections at once; swarm is per-daemon, so the user explicitly
  // picks WHICH Docker engine's swarm to manage via the ConnectionSelect below. Default to the first
  // connected Docker connection; keep the picked one while it stays connected.
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const dockerConnections = useMemo(
    () => connectedConnections(connections, activeRuntime, isDockerConnection),
    [connections, activeRuntime],
  );
  const [selectedConnId, setSelectedConnId] = useState("");
  const connectionId = dockerConnections.some((c) => c.id === selectedConnId)
    ? selectedConnId
    : (dockerConnections[0]?.id ?? "");

  const infoQuery = useSwarmInfo(connectionId, !!connectionId);
  const servicesQuery = useSwarmServices(connectionId, !!connectionId && !!infoQuery.data);
  const nodesQuery = useSwarmNodes(connectionId, !!connectionId && !!infoQuery.data);
  const stacksQuery = useSwarmStacks(connectionId, !!connectionId && !!infoQuery.data);
  const secretsQuery = useSwarmSecrets(connectionId, !!connectionId && !!infoQuery.data);
  const configsQuery = useSwarmConfigs(connectionId, !!connectionId && !!infoQuery.data);

  const swarmLeave = useSwarmLeave(connectionId);
  const scaleService = useScaleService(connectionId);
  const removeService = useRemoveService(connectionId);
  const updateNode = useUpdateNode(connectionId);
  const removeNode = useRemoveNode(connectionId);
  const removeSecret = useRemoveSwarmSecret(connectionId);
  const removeConfig = useRemoveSwarmConfig(connectionId);

  const onReload = useCallback(() => {
    infoQuery.refetch();
    servicesQuery.refetch();
    nodesQuery.refetch();
    stacksQuery.refetch();
    secretsQuery.refetch();
    configsQuery.refetch();
  }, [infoQuery, servicesQuery, nodesQuery, stacksQuery, secretsQuery, configsQuery]);

  // "Initialize Swarm" opens the InitializeDrawer form (advertise NIC + listen host/port + force-new-cluster)
  // instead of firing the mutation blind — which 400s on multi-NIC hosts that can't auto-pick an advertise addr.
  const [withInit, setWithInit] = useState(false);

  // Un-initialize: leave the swarm on this node. A single-node manager is the last manager, so Docker requires
  // `force` to erase it — without it the leave 400s ("you are attempting to leave the swarm on a node that is
  // participating as a manager"). This is the UI equivalent of `docker swarm leave --force`.
  const onLeaveSwarm = useCallback(() => {
    swarmLeave.mutate(
      { force: true },
      {
        // No success toast: the screen flipping back to the "not part of a Swarm" state is the feedback.
        onError: (error: any) => {
          const reason = extractApiErrorText(error, t("Request failed"));
          Notification.show({
            intent: Intent.DANGER,
            message: t("Could not leave the Swarm: {{reason}}", { reason }),
            detail: reason,
            timeout: 8000,
          });
        },
      },
    );
  }, [swarmLeave, t]);

  const matches = nameMatches(searchTerm);
  const services = useMemo(
    () => (servicesQuery.data ?? []).filter((s) => matches(s.Spec?.Name)),
    [servicesQuery.data, matches],
  );
  const nodes = useMemo(
    () => (nodesQuery.data ?? []).filter((n) => matches(n.Description?.Hostname)),
    [nodesQuery.data, matches],
  );
  const stacks = useMemo(() => (stacksQuery.data ?? []).filter((s) => matches(s.Name)), [stacksQuery.data, matches]);
  const secrets = useMemo(
    () => (secretsQuery.data ?? []).filter((s) => matches(s.Spec?.Name)),
    [secretsQuery.data, matches],
  );
  const configs = useMemo(
    () => (configsQuery.data ?? []).filter((c) => matches(c.Spec?.Name)),
    [configsQuery.data, matches],
  );

  const tabStrip = (
    <ButtonGroup className="SwarmHeaderTabs">
      {TABS.map((entry) => (
        <AnchorButton
          key={entry}
          variant="minimal"
          active={entry === tab}
          href={getSwarmTabUrl(entry, connectionId)}
          text={t(TAB_LABELS[entry])}
        />
      ))}
    </ButtonGroup>
  );

  const listActions = (
    <ButtonGroup>
      <Button variant="minimal" icon={IconNames.REFRESH} title={t("Reload")} onClick={onReload} />
      <PopoverNext
        usePortal
        placement="bottom-start"
        content={
          <Menu>
            <ConfirmMenuItem
              icon={IconNames.LOG_OUT}
              text={t("Leave Swarm")}
              title={t("Leave the Swarm on this node? This erases the single-node Swarm.")}
              intent={Intent.DANGER}
              onConfirm={onLeaveSwarm}
            />
          </Menu>
        }
      >
        <Button variant="minimal" icon={IconNames.MORE} />
      </PopoverNext>
    </ButtonGroup>
  );

  // No connected Docker engine at all — swarm is Docker-only (not Podman / Apple container).
  if (dockerConnections.length === 0) {
    return (
      <div className="AppScreen" data-screen={ID}>
        <AppScreenHeader withoutSearch titleText={t("Swarm")} titleIcon={IconNames.LAYERS} />
        <div className="AppScreenContent">
          <NonIdealState
            icon={IconNames.LAYERS}
            title={t("Swarm is a Docker feature")}
            description={<p>{t("It is not available for this engine. Connect a Docker engine to manage a swarm.")}</p>}
          />
        </div>
      </div>
    );
  }

  // The Docker-engine picker — shown in every state so the user can switch which connection's swarm they
  // manage (e.g. from a non-swarm engine to one that is a manager), and so "Initialize Swarm" clearly
  // targets the selected engine.
  const connectionSelector = (
    <ConnectionSelect
      inline
      value={connectionId}
      onChange={setSelectedConnId}
      filter={isDockerConnection}
      label={t("Docker engine")}
    />
  );

  const populated = !!infoQuery.data;
  let content: React.ReactNode;
  if (infoQuery.isLoading) {
    content = <NonIdealState icon={<Spinner size={28} />} title={t("Loading swarm…")} />;
  } else if (!populated) {
    // Docker connected but the SELECTED engine is not part of a swarm. Spell out what "Initialize" actually
    // does (this node becomes the manager; which resources it unlocks; the address it binds); the button opens
    // the InitializeDrawer form where the user picks the advertise NIC + listen address.
    content = (
      <NonIdealState
        icon={IconNames.LAYERS}
        title={t("This engine is not part of a Swarm")}
        className="SwarmInitState"
        description={
          <div className="SwarmInitAbout">
            <p>{t("Initializing creates a single-node Swarm and makes this Docker engine its manager.")}</p>
            <p>{t("You can then manage services, nodes, stacks, secrets and configs from here.")}</p>
          </div>
        }
        action={
          <Button
            intent={Intent.PRIMARY}
            icon={IconNames.PLUS}
            text={t("Initialize Swarm")}
            onClick={() => setWithInit(true)}
          />
        }
      />
    );
  } else if (tab === "nodes") {
    content = (
      <NodesTable
        nodes={nodes}
        connectionId={connectionId}
        onSetAvailability={(id, availability) => updateNode.mutate({ id, opts: { Availability: availability } })}
        onSetRole={(id, role) => updateNode.mutate({ id, opts: { Role: role } })}
        onRemove={(id) => removeNode.mutate(id)}
      />
    );
  } else if (tab === "stacks") {
    content = <StacksTable stacks={stacks} connectionId={connectionId} />;
  } else if (tab === "secrets") {
    content = <SecretsTable secrets={secrets} connectionId={connectionId} onRemove={(id) => removeSecret.mutate(id)} />;
  } else if (tab === "configs") {
    content = <ConfigsTable configs={configs} connectionId={connectionId} onRemove={(id) => removeConfig.mutate(id)} />;
  } else {
    content = (
      <ServicesTable
        services={services}
        connectionId={connectionId}
        onScale={(id, replicas) => scaleService.mutate({ id, replicas })}
        onRemove={(id) => removeService.mutate(id)}
      />
    );
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch={!populated}
        searchTerm={populated ? searchTerm : undefined}
        onSearch={populated ? onSearchChange : undefined}
        titleIcon={IconNames.LAYERS}
        rightContent={
          <>
            {connectionSelector}
            {populated ? (
              <>
                <Divider />
                {tabStrip}
                {listActions}
              </>
            ) : null}
          </>
        }
      />
      <div className="AppScreenContent">{content}</div>
      {withInit && connectionId ? (
        <InitializeDrawer connectionId={connectionId} onClose={() => setWithInit(false)} />
      ) : null}
    </div>
  );
};

const NoResults: React.FC<{ text: string }> = ({ text }) => {
  const { t } = useTranslation();
  return <NonIdealState icon={IconNames.GEOSEARCH} title={t("No results")} description={<p>{text}</p>} />;
};

// Exported so the Stack detail view (SwarmInspectScreen) reuses the same rich table (view link + scale +
// remove) for a stack's member services — no duplicate table.
export const ServicesTable: React.FC<{
  services: SwarmService[];
  connectionId: string;
  onScale: (id: string, replicas: number) => void;
  onRemove: (id: string) => void;
}> = ({ services, connectionId, onScale, onRemove }) => {
  const { t } = useTranslation();
  if (services.length === 0) {
    return <NoResults text={t("There are no services")} />;
  }
  return (
    <HTMLTable compact striped interactive className="AppDataTable" data-table="swarm.services">
      <thead>
        <tr>
          <th>{t("Name")}</th>
          <th>{t("Mode")}</th>
          <th>{t("Replicas")}</th>
          <th>{t("Image")}</th>
          <th>{t("Ports")}</th>
          <th data-column="Actions">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {services.map((service) => {
          const replicated = !service.Spec?.Mode?.Global;
          const replicas = service.Spec?.Mode?.Replicated?.Replicas ?? 0;
          return (
            <tr key={service.ID} data-service={service.ID}>
              <td>
                <AppDataTableLink
                  fillCell
                  href={getSwarmInspectUrl("services", service.ID, connectionId)}
                  iconName={IconNames.EYE_OPEN}
                  text={service.Spec?.Name || service.ID}
                />
              </td>
              <td>{service.Spec?.Mode?.Global ? t("global") : t("replicated")}</td>
              <td>{serviceReplicas(service)}</td>
              <td>{service.Spec?.TaskTemplate?.ContainerSpec?.Image || "—"}</td>
              <td>{servicePorts(service)}</td>
              <td data-column="Actions">
                <ConfirmMenu
                  tag={service.ID}
                  title={t("Remove service {{name}}", { name: service.Spec?.Name || service.ID })}
                  onConfirm={(id, confirmed) => confirmed && onRemove(id)}
                >
                  {replicated ? (
                    <>
                      <MenuItem
                        icon={IconNames.PLUS}
                        text={t("Scale up")}
                        onClick={() => onScale(service.ID, replicas + 1)}
                      />
                      <MenuItem
                        icon={IconNames.MINUS}
                        text={t("Scale down")}
                        disabled={replicas <= 0}
                        onClick={() => onScale(service.ID, Math.max(0, replicas - 1))}
                      />
                    </>
                  ) : null}
                </ConfirmMenu>
              </td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
};

const NodesTable: React.FC<{
  nodes: SwarmNode[];
  connectionId: string;
  onSetAvailability: (id: string, availability: "active" | "drain") => void;
  onSetRole: (id: string, role: "manager" | "worker") => void;
  onRemove: (id: string) => void;
}> = ({ nodes, connectionId, onSetAvailability, onSetRole, onRemove }) => {
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return <NoResults text={t("There are no nodes")} />;
  }
  return (
    <HTMLTable compact striped interactive className="AppDataTable" data-table="swarm.nodes">
      <thead>
        <tr>
          <th>{t("Hostname")}</th>
          <th>{t("Role")}</th>
          <th>{t("Availability")}</th>
          <th>{t("State")}</th>
          <th>{t("Manager")}</th>
          <th>{t("Engine")}</th>
          <th data-column="Actions">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((node) => {
          const role = node.Spec?.Role ?? "worker";
          const availability = node.Spec?.Availability ?? "active";
          const leader = node.ManagerStatus?.Leader === true;
          return (
            <tr key={node.ID} data-node={node.ID}>
              <td>
                <AppDataTableLink
                  fillCell
                  href={getSwarmInspectUrl("nodes", node.ID, connectionId)}
                  iconName={IconNames.EYE_OPEN}
                  text={node.Description?.Hostname || node.ID}
                />
              </td>
              <td>{role}</td>
              <td>
                <Tag minimal intent={availability === "active" ? Intent.SUCCESS : Intent.WARNING}>
                  {availability}
                </Tag>
              </td>
              <td>
                <Tag minimal intent={node.Status?.State === "ready" ? Intent.SUCCESS : Intent.DANGER}>
                  {node.Status?.State || "—"}
                </Tag>
              </td>
              <td>{leader ? t("leader") : role === "manager" ? t("reachable") : "—"}</td>
              <td>{node.Description?.Engine?.EngineVersion || "—"}</td>
              <td data-column="Actions">
                <ConfirmMenu
                  tag={node.ID}
                  title={t("Remove node {{name}}", { name: node.Description?.Hostname || node.ID })}
                  onConfirm={(id, confirmed) => confirmed && onRemove(id)}
                >
                  {availability === "drain" ? (
                    <MenuItem
                      icon={IconNames.PLAY}
                      text={t("Activate")}
                      onClick={() => onSetAvailability(node.ID, "active")}
                    />
                  ) : (
                    <MenuItem
                      icon={IconNames.PAUSE}
                      text={t("Drain")}
                      onClick={() => onSetAvailability(node.ID, "drain")}
                    />
                  )}
                  {role === "worker" ? (
                    <MenuItem
                      icon={IconNames.ARROW_UP}
                      text={t("Promote to manager")}
                      onClick={() => onSetRole(node.ID, "manager")}
                    />
                  ) : (
                    <MenuItem
                      icon={IconNames.ARROW_DOWN}
                      text={t("Demote to worker")}
                      onClick={() => onSetRole(node.ID, "worker")}
                    />
                  )}
                </ConfirmMenu>
              </td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
};

const StacksTable: React.FC<{ stacks: SwarmStack[]; connectionId: string }> = ({ stacks, connectionId }) => {
  const { t } = useTranslation();
  if (stacks.length === 0) {
    return <NoResults text={t("There are no stacks")} />;
  }
  return (
    <HTMLTable compact striped interactive className="AppDataTable" data-table="swarm.stacks">
      <thead>
        <tr>
          <th>{t("Name")}</th>
          <th>{t("Services")}</th>
          <th>{t("Orchestrator")}</th>
        </tr>
      </thead>
      <tbody>
        {stacks.map((stack) => (
          <tr key={stack.Name} data-stack={stack.Name}>
            <td>
              <AppDataTableLink
                fillCell
                href={getSwarmInspectUrl("stacks", stack.Name, connectionId)}
                iconName={IconNames.LAYERS}
                text={stack.Name}
              />
            </td>
            <td>{stack.Services}</td>
            <td>{stack.Orchestrator}</td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
};

const SecretsTable: React.FC<{ secrets: SwarmSecret[]; connectionId: string; onRemove: (id: string) => void }> = ({
  secrets,
  connectionId,
  onRemove,
}) => {
  const { t } = useTranslation();
  if (secrets.length === 0) {
    return <NoResults text={t("There are no secrets")} />;
  }
  return (
    <HTMLTable compact striped interactive className="AppDataTable" data-table="swarm.secrets">
      <thead>
        <tr>
          <th>{t("Name")}</th>
          <th>{t("Created")}</th>
          <th data-column="Actions">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {secrets.map((secret) => (
          <tr key={secret.ID} data-secret={secret.ID}>
            <td>
              <AppDataTableLink
                fillCell
                href={getSwarmInspectUrl("secrets", secret.ID, connectionId)}
                iconName={IconNames.EYE_OPEN}
                text={secret.Spec?.Name || secret.ID}
              />
            </td>
            <td>{secret.CreatedAt ? dayjs(secret.CreatedAt).format("DD MMM YYYY HH:mm") : "—"}</td>
            <td data-column="Actions">
              <ConfirmMenu
                tag={secret.ID}
                title={t("Remove secret {{name}}", { name: secret.Spec?.Name || secret.ID })}
                onConfirm={(id, confirmed) => confirmed && onRemove(id)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
};

const ConfigsTable: React.FC<{ configs: SwarmConfig[]; connectionId: string; onRemove: (id: string) => void }> = ({
  configs,
  connectionId,
  onRemove,
}) => {
  const { t } = useTranslation();
  if (configs.length === 0) {
    return <NoResults text={t("There are no configs")} />;
  }
  return (
    <HTMLTable compact striped interactive className="AppDataTable" data-table="swarm.configs">
      <thead>
        <tr>
          <th>{t("Name")}</th>
          <th>{t("Created")}</th>
          <th data-column="Actions">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {configs.map((config) => (
          <tr key={config.ID} data-config={config.ID}>
            <td>
              <AppDataTableLink
                fillCell
                href={getSwarmInspectUrl("configs", config.ID, connectionId)}
                iconName={IconNames.EYE_OPEN}
                text={config.Spec?.Name || config.ID}
              />
            </td>
            <td>{config.CreatedAt ? dayjs(config.CreatedAt).format("DD MMM YYYY HH:mm") : "—"}</td>
            <td data-column="Actions">
              <ConfirmMenu
                tag={config.ID}
                title={t("Remove config {{name}}", { name: config.Spec?.Name || config.ID })}
                onConfirm={(id, confirmed) => confirmed && onRemove(id)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
};

Screen.ID = ID;
Screen.Title = "Swarm";
Screen.Route = {
  Path: "/screens/swarm",
};
Screen.Metadata = {
  LeftIcon: IconNames.LAYERS,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.extensions.swarm === true;
};

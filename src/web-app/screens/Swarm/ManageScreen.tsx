import {
  AnchorButton,
  Button,
  ButtonGroup,
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
import { useQueries } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SwarmAdapter } from "@/container-client/adapters/swarm";
import type { Connector } from "@/container-client/types/connection";
import type { SwarmConfig, SwarmNode, SwarmSecret, SwarmService, SwarmStack } from "@/container-client/types/swarm";
import i18n from "@/i18n";
import { extractApiErrorText } from "@/utils/apiError";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { ConfirmMenu, ConfirmMenuItem } from "@/web-app/components/ConfirmMenu";
import { connectedConnections, isDockerConnection } from "@/web-app/components/ConnectionSelect";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { liveQueryOptions } from "@/web-app/domain/queryClient";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useGroupByConnection, useShowEngineRowAccent } from "@/web-app/hooks/useMergedResources";
import { useRouteSearch } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { InitializeDrawer } from "./InitializeDrawer";
import { getSwarmInspectUrl, getSwarmTabUrl, type SwarmTab } from "./Navigation";
import {
  swarmKeys,
  swarmRetry,
  useRemoveNode,
  useRemoveService,
  useRemoveSwarmConfig,
  useRemoveSwarmSecret,
  useScaleService,
  useSwarmLeave,
  useUpdateNode,
} from "./queries";

import "./ManageScreen.css";

export const ID = "swarm";
export interface ScreenProps extends AppScreenProps {}

const TABS: SwarmTab[] = ["services", "nodes", "stacks", "secrets", "configs"];
const SERVICES_SORT_SCOPE = "swarm.services";
const SERVICE_SORT_CAPABILITIES = {
  [`${SERVICES_SORT_SCOPE}.name`]: "client",
  [`${SERVICES_SORT_SCOPE}.mode`]: "client",
  [`${SERVICES_SORT_SCOPE}.replicas`]: "client",
  [`${SERVICES_SORT_SCOPE}.image`]: "client",
  [`${SERVICES_SORT_SCOPE}.ports`]: "client",
} as const;
const NODES_SORT_SCOPE = "swarm.nodes";
const NODE_SORT_CAPABILITIES = {
  [`${NODES_SORT_SCOPE}.hostname`]: "client",
  [`${NODES_SORT_SCOPE}.role`]: "client",
  [`${NODES_SORT_SCOPE}.availability`]: "client",
  [`${NODES_SORT_SCOPE}.state`]: "client",
  [`${NODES_SORT_SCOPE}.manager`]: "client",
  [`${NODES_SORT_SCOPE}.engine`]: "client",
} as const;
const STACKS_SORT_SCOPE = "swarm.stacks";
const STACK_SORT_CAPABILITIES = {
  [`${STACKS_SORT_SCOPE}.name`]: "client",
  [`${STACKS_SORT_SCOPE}.services`]: "client",
  [`${STACKS_SORT_SCOPE}.orchestrator`]: "client",
} as const;
const SECRETS_SORT_SCOPE = "swarm.secrets";
const SECRET_SORT_CAPABILITIES = {
  [`${SECRETS_SORT_SCOPE}.name`]: "client",
  [`${SECRETS_SORT_SCOPE}.created`]: "client",
} as const;
const CONFIGS_SORT_SCOPE = "swarm.configs";
const CONFIG_SORT_CAPABILITIES = {
  [`${CONFIGS_SORT_SCOPE}.name`]: "client",
  [`${CONFIGS_SORT_SCOPE}.created`]: "client",
} as const;
const TAB_LABELS: Record<SwarmTab, string> = {
  services: i18n.t("Services"),
  nodes: i18n.t("Nodes"),
  stacks: i18n.t("Stacks"),
  secrets: i18n.t("Secrets"),
  configs: i18n.t("Configs"),
};

type SwarmConnectionMeta = {
  id: string;
  name: string;
  engine: string;
};

type SwarmGroupedRow<T> = T & {
  connectionId: string;
  connectionName: string;
  engine: string;
};

interface SwarmConnectionGroup<T> extends ConnectionGroup<SwarmGroupedRow<T>> {
  connection: SwarmConnectionMeta;
}

async function resolveSwarmAdapter(connectionId: string) {
  const host = await resolveConnectionHost(connectionId);
  if (!host) {
    throw new Error("No active engine connection");
  }
  return new SwarmAdapter(host);
}

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

const serviceSortSelectors: SortSelectors<SwarmGroupedRow<SwarmService>> = {
  name: (service) => service.Spec?.Name || service.ID,
  mode: (service) => (service.Spec?.Mode?.Global ? "global" : "replicated"),
  replicas: (service) =>
    service.Spec?.Mode?.Global ? Number.MAX_SAFE_INTEGER : (service.Spec?.Mode?.Replicated?.Replicas ?? 0),
  image: (service) => service.Spec?.TaskTemplate?.ContainerSpec?.Image,
  ports: (service) => servicePorts(service),
};

const nodeSortSelectors: SortSelectors<SwarmGroupedRow<SwarmNode>> = {
  hostname: (node) => node.Description?.Hostname || node.ID,
  role: (node) => node.Spec?.Role,
  availability: (node) => node.Spec?.Availability,
  state: (node) => node.Status?.State,
  manager: (node) =>
    node.ManagerStatus?.Leader === true ? "leader" : node.Spec?.Role === "manager" ? "reachable" : undefined,
  engine: (node) => node.Description?.Engine?.EngineVersion,
};

const stackSortSelectors: SortSelectors<SwarmGroupedRow<SwarmStack>> = {
  name: (stack) => stack.Name,
  services: (stack) => stack.Services,
  orchestrator: (stack) => stack.Orchestrator,
};

const secretSortSelectors: SortSelectors<SwarmGroupedRow<SwarmSecret>> = {
  name: (secret) => secret.Spec?.Name || secret.ID,
  created: (secret) => Date.parse(secret.CreatedAt || ""),
};

const configSortSelectors: SortSelectors<SwarmGroupedRow<SwarmConfig>> = {
  name: (config) => config.Spec?.Name || config.ID,
  created: (config) => Date.parse(config.CreatedAt || ""),
};

const nameMatches = (term: string) => {
  const query = term.toLowerCase();
  return (name?: string) => !query || (name ?? "").toLowerCase().includes(query);
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { tab: tabParam } = useRouteSearch<{ tab?: SwarmTab }>();
  const tab: SwarmTab = TABS.includes(tabParam as SwarmTab) ? (tabParam as SwarmTab) : "services";

  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const dockerConnections = useMemo(
    () => connectedConnections(connections, activeRuntime, isDockerConnection),
    [connections, activeRuntime],
  );
  const showEngineRowAccent = useShowEngineRowAccent();
  const {
    clientSort: servicesClientSort,
    getColumnSortDirection: getServicesColumnSortDirection,
    toggleColumnSort: toggleServicesColumnSort,
  } = useColumnSort(SERVICES_SORT_SCOPE, SERVICE_SORT_CAPABILITIES);
  const {
    clientSort: nodesClientSort,
    getColumnSortDirection: getNodesColumnSortDirection,
    toggleColumnSort: toggleNodesColumnSort,
  } = useColumnSort(NODES_SORT_SCOPE, NODE_SORT_CAPABILITIES);
  const {
    clientSort: stacksClientSort,
    getColumnSortDirection: getStacksColumnSortDirection,
    toggleColumnSort: toggleStacksColumnSort,
  } = useColumnSort(STACKS_SORT_SCOPE, STACK_SORT_CAPABILITIES);
  const {
    clientSort: secretsClientSort,
    getColumnSortDirection: getSecretsColumnSortDirection,
    toggleColumnSort: toggleSecretsColumnSort,
  } = useColumnSort(SECRETS_SORT_SCOPE, SECRET_SORT_CAPABILITIES);
  const {
    clientSort: configsClientSort,
    getColumnSortDirection: getConfigsColumnSortDirection,
    toggleColumnSort: toggleConfigsColumnSort,
  } = useColumnSort(CONFIGS_SORT_SCOPE, CONFIG_SORT_CAPABILITIES);

  const infoQueries = useQueries({
    queries: dockerConnections.map((connection) => ({
      queryKey: swarmKeys.info(connection.id),
      queryFn: async () => (await (await resolveSwarmAdapter(connection.id)).inspect()) ?? null,
      enabled: !!connection.id,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: swarmRetry,
    })),
  });
  const populatedConnectionIds = useMemo(
    () =>
      new Set(dockerConnections.filter((_, index) => !!infoQueries[index]?.data).map((connection) => connection.id)),
    [dockerConnections, infoQueries],
  );
  const servicesQueries = useQueries({
    queries: dockerConnections.map((connection) => ({
      queryKey: swarmKeys.services(connection.id),
      queryFn: async () => (await resolveSwarmAdapter(connection.id)).listServices(),
      enabled: populatedConnectionIds.has(connection.id),
      ...liveQueryOptions(),
      retry: swarmRetry,
    })),
  });
  const nodesQueries = useQueries({
    queries: dockerConnections.map((connection) => ({
      queryKey: swarmKeys.nodes(connection.id),
      queryFn: async () => (await resolveSwarmAdapter(connection.id)).listNodes(),
      enabled: populatedConnectionIds.has(connection.id),
      ...liveQueryOptions(),
      retry: swarmRetry,
    })),
  });
  const stacksQueries = useQueries({
    queries: dockerConnections.map((connection) => ({
      queryKey: swarmKeys.stacks(connection.id),
      queryFn: async () => (await resolveSwarmAdapter(connection.id)).listStacks(),
      enabled: populatedConnectionIds.has(connection.id),
      ...liveQueryOptions(),
      retry: swarmRetry,
    })),
  });
  const secretsQueries = useQueries({
    queries: dockerConnections.map((connection) => ({
      queryKey: swarmKeys.secrets(connection.id),
      queryFn: async () => (await resolveSwarmAdapter(connection.id)).listSecrets(),
      enabled: populatedConnectionIds.has(connection.id),
      ...liveQueryOptions(),
      retry: swarmRetry,
    })),
  });
  const configsQueries = useQueries({
    queries: dockerConnections.map((connection) => ({
      queryKey: swarmKeys.configs(connection.id),
      queryFn: async () => (await resolveSwarmAdapter(connection.id)).listConfigs(),
      enabled: populatedConnectionIds.has(connection.id),
      ...liveQueryOptions(),
      retry: swarmRetry,
    })),
  });

  const singleDockerConnectionId = dockerConnections.length === 1 ? (dockerConnections[0]?.id ?? "") : "";
  const swarmLeave = useSwarmLeave(singleDockerConnectionId);

  const onReload = useCallback(() => {
    if (populatedConnectionIds.size === 0) {
      return;
    }
    for (const query of [
      ...infoQueries,
      ...servicesQueries,
      ...nodesQueries,
      ...stacksQueries,
      ...secretsQueries,
      ...configsQueries,
    ]) {
      query.refetch();
    }
  }, [
    configsQueries,
    infoQueries,
    nodesQueries,
    populatedConnectionIds,
    secretsQueries,
    servicesQueries,
    stacksQueries,
  ]);

  // "Initialize Swarm" opens the InitializeDrawer form (advertise NIC + listen host/port + force-new-cluster)
  // instead of firing the mutation blind — which 400s on multi-NIC hosts that can't auto-pick an advertise addr.
  const [withInit, setWithInit] = useState(false);

  // Un-initialize: leave the swarm on this node. A single-node manager is the last manager, so Docker requires
  // `force` to erase it — without it the leave 400s ("you are attempting to leave the swarm on a node that is
  // participating as a manager"). This is the UI equivalent of `docker swarm leave --force`.
  const onLeaveSwarm = useCallback(() => {
    if (!singleDockerConnectionId) {
      return;
    }
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
  }, [singleDockerConnectionId, swarmLeave, t]);

  const matches = nameMatches(searchTerm);
  const compareServices = useCallback(
    (a: SwarmGroupedRow<SwarmService>, b: SwarmGroupedRow<SwarmService>) => {
      if (servicesClientSort) {
        const selector = serviceSortSelectors[servicesClientSort.field];
        if (selector) {
          return (servicesClientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Spec?.Name || a.ID, b.Spec?.Name || b.ID);
    },
    [servicesClientSort],
  );
  const compareNodes = useCallback(
    (a: SwarmGroupedRow<SwarmNode>, b: SwarmGroupedRow<SwarmNode>) => {
      if (nodesClientSort) {
        const selector = nodeSortSelectors[nodesClientSort.field];
        if (selector) {
          return (nodesClientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Description?.Hostname || a.ID, b.Description?.Hostname || b.ID);
    },
    [nodesClientSort],
  );
  const compareStacks = useCallback(
    (a: SwarmGroupedRow<SwarmStack>, b: SwarmGroupedRow<SwarmStack>) => {
      if (stacksClientSort) {
        const selector = stackSortSelectors[stacksClientSort.field];
        if (selector) {
          return (stacksClientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Name, b.Name);
    },
    [stacksClientSort],
  );
  const compareSecrets = useCallback(
    (a: SwarmGroupedRow<SwarmSecret>, b: SwarmGroupedRow<SwarmSecret>) => {
      if (secretsClientSort) {
        const selector = secretSortSelectors[secretsClientSort.field];
        if (selector) {
          return (secretsClientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Spec?.Name || a.ID, b.Spec?.Name || b.ID);
    },
    [secretsClientSort],
  );
  const compareConfigs = useCallback(
    (a: SwarmGroupedRow<SwarmConfig>, b: SwarmGroupedRow<SwarmConfig>) => {
      if (configsClientSort) {
        const selector = configSortSelectors[configsClientSort.field];
        if (selector) {
          return (configsClientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Spec?.Name || a.ID, b.Spec?.Name || b.ID);
    },
    [configsClientSort],
  );
  const servicesGroups = useMemo<SwarmConnectionGroup<SwarmService>[]>(
    () =>
      dockerConnections.map((connection, index) => ({
        key: connection.id,
        connection,
        items: populatedConnectionIds.has(connection.id)
          ? (servicesQueries[index]?.data ?? [])
              .filter((service) => matches(service.Spec?.Name))
              .map((service) => ({
                ...service,
                connectionId: connection.id,
                connectionName: connection.name,
                engine: connection.engine,
              }))
              .sort(compareServices)
          : [],
      })),
    [compareServices, dockerConnections, matches, populatedConnectionIds, servicesQueries],
  );
  const nodesGroups = useMemo<SwarmConnectionGroup<SwarmNode>[]>(
    () =>
      dockerConnections.map((connection, index) => ({
        key: connection.id,
        connection,
        items: populatedConnectionIds.has(connection.id)
          ? (nodesQueries[index]?.data ?? [])
              .filter((node) => matches(node.Description?.Hostname))
              .map((node) => ({
                ...node,
                connectionId: connection.id,
                connectionName: connection.name,
                engine: connection.engine,
              }))
              .sort(compareNodes)
          : [],
      })),
    [compareNodes, dockerConnections, matches, nodesQueries, populatedConnectionIds],
  );
  const stacksGroups = useMemo<SwarmConnectionGroup<SwarmStack>[]>(
    () =>
      dockerConnections.map((connection, index) => ({
        key: connection.id,
        connection,
        items: populatedConnectionIds.has(connection.id)
          ? (stacksQueries[index]?.data ?? [])
              .filter((stack) => matches(stack.Name))
              .map((stack) => ({
                ...stack,
                connectionId: connection.id,
                connectionName: connection.name,
                engine: connection.engine,
              }))
              .sort(compareStacks)
          : [],
      })),
    [compareStacks, dockerConnections, matches, populatedConnectionIds, stacksQueries],
  );
  const secretsGroups = useMemo<SwarmConnectionGroup<SwarmSecret>[]>(
    () =>
      dockerConnections.map((connection, index) => ({
        key: connection.id,
        connection,
        items: populatedConnectionIds.has(connection.id)
          ? (secretsQueries[index]?.data ?? [])
              .filter((secret) => matches(secret.Spec?.Name))
              .map((secret) => ({
                ...secret,
                connectionId: connection.id,
                connectionName: connection.name,
                engine: connection.engine,
              }))
              .sort(compareSecrets)
          : [],
      })),
    [compareSecrets, dockerConnections, matches, populatedConnectionIds, secretsQueries],
  );
  const configsGroups = useMemo<SwarmConnectionGroup<SwarmConfig>[]>(
    () =>
      dockerConnections.map((connection, index) => ({
        key: connection.id,
        connection,
        items: populatedConnectionIds.has(connection.id)
          ? (configsQueries[index]?.data ?? [])
              .filter((config) => matches(config.Spec?.Name))
              .map((config) => ({
                ...config,
                connectionId: connection.id,
                connectionName: connection.name,
                engine: connection.engine,
              }))
              .sort(compareConfigs)
          : [],
      })),
    [compareConfigs, configsQueries, dockerConnections, matches, populatedConnectionIds],
  );

  const tabStrip = (
    <ButtonGroup className="SwarmHeaderTabs">
      {TABS.map((entry) => (
        <AnchorButton
          key={entry}
          variant="minimal"
          active={entry === tab}
          href={getSwarmTabUrl(entry)}
          text={t(TAB_LABELS[entry])}
        />
      ))}
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

  const populated = populatedConnectionIds.size > 0;
  const infoLoading = infoQueries.some((query) => query.isLoading);
  const canInitializeSingleConnection = !populated && !!singleDockerConnectionId && !infoLoading;
  const canLeaveSingleConnection =
    populated && !!singleDockerConnectionId && populatedConnectionIds.has(singleDockerConnectionId);
  const leaveSwarmAction = canLeaveSingleConnection ? (
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
  ) : null;
  const swarmHeaderActions = (
    <ResourceListActions
      actions={
        canInitializeSingleConnection
          ? { icon: IconNames.PLUS, text: t("Initialize Swarm"), onClick: () => setWithInit(true) }
          : undefined
      }
      navigation={populated ? tabStrip : undefined}
      onReload={onReload}
      reloadDisabled={!populated}
      reloadTitle={t("Reload current screen")}
      utilityActions={leaveSwarmAction}
      utilityActionsPlacement="before-reload"
    />
  );
  let content: React.ReactNode;
  if (infoLoading && !populated) {
    content = <NonIdealState icon={<Spinner size={28} />} title={t("Loading swarm…")} />;
  } else if (!populated) {
    content = (
      <NonIdealState
        icon={IconNames.LAYERS}
        title={t("No Docker connection is part of a Swarm")}
        className="SwarmInitState"
        description={
          <div className="SwarmInitAbout">
            <p>{t("Initialize a single Docker engine to create a Swarm manager.")}</p>
            <p>{t("You can then manage services, nodes, stacks, secrets and configs from here.")}</p>
          </div>
        }
      />
    );
  } else if (tab === "nodes") {
    content = (
      <GroupedNodesTable
        groups={nodesGroups}
        showEngineRowAccent={showEngineRowAccent}
        getColumnSortDirection={getNodesColumnSortDirection}
        onColumnSort={toggleNodesColumnSort}
      />
    );
  } else if (tab === "stacks") {
    content = (
      <GroupedStacksTable
        groups={stacksGroups}
        showEngineRowAccent={showEngineRowAccent}
        getColumnSortDirection={getStacksColumnSortDirection}
        onColumnSort={toggleStacksColumnSort}
      />
    );
  } else if (tab === "secrets") {
    content = (
      <GroupedSecretsTable
        groups={secretsGroups}
        showEngineRowAccent={showEngineRowAccent}
        getColumnSortDirection={getSecretsColumnSortDirection}
        onColumnSort={toggleSecretsColumnSort}
      />
    );
  } else if (tab === "configs") {
    content = (
      <GroupedConfigsTable
        groups={configsGroups}
        showEngineRowAccent={showEngineRowAccent}
        getColumnSortDirection={getConfigsColumnSortDirection}
        onColumnSort={toggleConfigsColumnSort}
      />
    );
  } else {
    content = (
      <GroupedServicesTable
        groups={servicesGroups}
        showEngineRowAccent={showEngineRowAccent}
        getColumnSortDirection={getServicesColumnSortDirection}
        onColumnSort={toggleServicesColumnSort}
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
        rightContent={swarmHeaderActions}
      />
      <div className="AppScreenContent">{content}</div>
      {withInit && singleDockerConnectionId ? (
        <InitializeDrawer connectionId={singleDockerConnectionId} onClose={() => setWithInit(false)} />
      ) : null}
    </div>
  );
};

const NoResults: React.FC<{ text: string }> = ({ text }) => {
  const { t } = useTranslation();
  return <NonIdealState icon={IconNames.GEOSEARCH} title={t("No results")} description={<p>{text}</p>} />;
};

function SwarmGroupHeaderRow<T>({
  group,
  columnCount,
  collapsed,
  striped,
  showEngineRowAccent,
  resourceSingular,
  resourcePlural,
  onGroupToggleClick,
  measureRef,
  index,
}: {
  group: SwarmConnectionGroup<T>;
  columnCount: number;
  collapsed: boolean;
  striped?: string;
  showEngineRowAccent: boolean;
  resourceSingular: string;
  resourcePlural: string;
  onGroupToggleClick: React.MouseEventHandler<HTMLElement>;
  measureRef: (node: HTMLTableRowElement | null) => void;
  index: number;
}) {
  const { t } = useTranslation();
  return (
    <tr
      ref={measureRef}
      data-index={index}
      data-striped={striped}
      className="AppDataTableGroupRow"
      data-engine-row={showEngineRowAccent ? group.connection.engine : undefined}
    >
      <td className="AppDataTableGroupName" colSpan={columnCount}>
        <Button
          variant="minimal"
          icon={collapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
          onClick={onGroupToggleClick}
          data-prefix-group={group.key}
          title={t("{{name}} swarm resources", { name: group.connection.name })}
          text={
            <>
              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
              <span className="buttonTextLabel">{group.connection.name}</span>
              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
              <span className="GroupedTableGroupSum">
                {group.items.length} {group.items.length === 1 ? t(resourceSingular) : t(resourcePlural)}
              </span>
            </>
          }
        />
      </td>
    </tr>
  );
}

const ServiceActionsCell: React.FC<{ service: SwarmGroupedRow<SwarmService> }> = ({ service }) => {
  const { t } = useTranslation();
  const scaleService = useScaleService(service.connectionId);
  const removeService = useRemoveService(service.connectionId);
  const replicated = !service.Spec?.Mode?.Global;
  const replicas = service.Spec?.Mode?.Replicated?.Replicas ?? 0;
  return (
    <ConfirmMenu
      tag={service.ID}
      title={t("Remove service {{name}}", { name: service.Spec?.Name || service.ID })}
      onConfirm={(id, confirmed) => confirmed && removeService.mutate(id)}
    >
      {replicated ? (
        <>
          <MenuItem
            icon={IconNames.PLUS}
            text={t("Scale up")}
            onClick={() => scaleService.mutate({ id: service.ID, replicas: replicas + 1 })}
          />
          <MenuItem
            icon={IconNames.MINUS}
            text={t("Scale down")}
            disabled={replicas <= 0}
            onClick={() => scaleService.mutate({ id: service.ID, replicas: Math.max(0, replicas - 1) })}
          />
        </>
      ) : null}
    </ConfirmMenu>
  );
};

const NodeActionsCell: React.FC<{ node: SwarmGroupedRow<SwarmNode> }> = ({ node }) => {
  const { t } = useTranslation();
  const updateNode = useUpdateNode(node.connectionId);
  const removeNode = useRemoveNode(node.connectionId);
  const role = node.Spec?.Role ?? "worker";
  const availability = node.Spec?.Availability ?? "active";
  return (
    <ConfirmMenu
      tag={node.ID}
      title={t("Remove node {{name}}", { name: node.Description?.Hostname || node.ID })}
      onConfirm={(id, confirmed) => confirmed && removeNode.mutate(id)}
    >
      {availability === "drain" ? (
        <MenuItem
          icon={IconNames.PLAY}
          text={t("Activate")}
          onClick={() => updateNode.mutate({ id: node.ID, opts: { Availability: "active" } })}
        />
      ) : (
        <MenuItem
          icon={IconNames.PAUSE}
          text={t("Drain")}
          onClick={() => updateNode.mutate({ id: node.ID, opts: { Availability: "drain" } })}
        />
      )}
      {role === "worker" ? (
        <MenuItem
          icon={IconNames.ARROW_UP}
          text={t("Promote to manager")}
          onClick={() => updateNode.mutate({ id: node.ID, opts: { Role: "manager" } })}
        />
      ) : (
        <MenuItem
          icon={IconNames.ARROW_DOWN}
          text={t("Demote to worker")}
          onClick={() => updateNode.mutate({ id: node.ID, opts: { Role: "worker" } })}
        />
      )}
    </ConfirmMenu>
  );
};

const SecretActionsCell: React.FC<{ secret: SwarmGroupedRow<SwarmSecret> }> = ({ secret }) => {
  const { t } = useTranslation();
  const removeSecret = useRemoveSwarmSecret(secret.connectionId);
  return (
    <ConfirmMenu
      tag={secret.ID}
      title={t("Remove secret {{name}}", { name: secret.Spec?.Name || secret.ID })}
      onConfirm={(id, confirmed) => confirmed && removeSecret.mutate(id)}
    />
  );
};

const ConfigActionsCell: React.FC<{ config: SwarmGroupedRow<SwarmConfig> }> = ({ config }) => {
  const { t } = useTranslation();
  const removeConfig = useRemoveSwarmConfig(config.connectionId);
  return (
    <ConfirmMenu
      tag={config.ID}
      title={t("Remove config {{name}}", { name: config.Spec?.Name || config.ID })}
      onConfirm={(id, confirmed) => confirmed && removeConfig.mutate(id)}
    />
  );
};

const GroupedServicesTable: React.FC<{
  groups: SwarmConnectionGroup<SwarmService>[];
  showEngineRowAccent: boolean;
  getColumnSortDirection: (field: string) => "asc" | "desc" | undefined;
  onColumnSort: (field: string) => void;
}> = ({ groups, showEngineRowAccent, getColumnSortDirection, onColumnSort }) => {
  const { t } = useTranslation();
  const columnCount = 6;
  const grouped = useGroupByConnection();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({
      groups,
      getRowKey: (service) => `${service.connectionId}:${service.ID}`,
      scrollKey: "swarm.services",
      grouped,
    });
  return (
    <div className="GroupedTableScroll" ref={scrollElementRef}>
      <HTMLTable
        compact
        interactive
        className="AppDataTable GroupedTable SwarmTable"
        data-windowed="true"
        data-table="swarm.services"
        data-grouped={grouped ? "true" : "false"}
      >
        <thead ref={theadRef}>
          <tr>
            <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={onColumnSort}>
              <AppLabel iconName={IconNames.LAYERS} text={t("Name")} />
            </SortableColumnHeader>
            <SortableColumnHeader field="mode" direction={getColumnSortDirection("mode")} onSort={onColumnSort}>
              {t("Mode")}
            </SortableColumnHeader>
            <SortableColumnHeader field="replicas" direction={getColumnSortDirection("replicas")} onSort={onColumnSort}>
              {t("Replicas")}
            </SortableColumnHeader>
            <SortableColumnHeader field="image" direction={getColumnSortDirection("image")} onSort={onColumnSort}>
              {t("Image")}
            </SortableColumnHeader>
            <SortableColumnHeader field="ports" direction={getColumnSortDirection("ports")} onSort={onColumnSort}>
              {t("Ports")}
            </SortableColumnHeader>
            <th data-column="Actions">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <VirtualSpacerRow height={paddingTop} columnCount={columnCount} />
          {items.map(({ row: descriptor, index, key }) => {
            const striped = index % 2 === 0 ? "true" : undefined;
            if (descriptor.kind === "group-header") {
              return (
                <SwarmGroupHeaderRow
                  key={key}
                  group={descriptor.group as SwarmConnectionGroup<SwarmService>}
                  columnCount={columnCount}
                  collapsed={isCollapsed(descriptor.groupKey)}
                  striped={striped}
                  showEngineRowAccent={showEngineRowAccent}
                  resourceSingular="service"
                  resourcePlural="services"
                  onGroupToggleClick={onGroupToggleClick}
                  measureRef={measureRef}
                  index={index}
                />
              );
            }
            const service = descriptor.item;
            const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
            return (
              <tr
                key={key}
                ref={measureRef}
                data-index={index}
                data-prefix-group={service.connectionId}
                data-striped={striped}
                data-service={service.ID}
                data-engine-row={showEngineRowAccent ? service.engine : undefined}
              >
                <td>
                  <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                    <div className="AppDataTableGroupLinkVertical" />
                    <div className="AppDataTableGroupLinkHorizontal" />
                  </div>
                  <AppDataTableLink
                    fillCell
                    href={getSwarmInspectUrl("services", service.ID, service.connectionId)}
                    iconName={IconNames.EYE_OPEN}
                    text={service.Spec?.Name || service.ID}
                  />
                </td>
                <td>{service.Spec?.Mode?.Global ? t("global") : t("replicated")}</td>
                <td>{serviceReplicas(service)}</td>
                <td>{service.Spec?.TaskTemplate?.ContainerSpec?.Image || "—"}</td>
                <td>{servicePorts(service)}</td>
                <td data-column="Actions">
                  <ServiceActionsCell service={service} />
                </td>
              </tr>
            );
          })}
          <VirtualSpacerRow height={paddingBottom} columnCount={columnCount} />
        </tbody>
      </HTMLTable>
    </div>
  );
};

const GroupedNodesTable: React.FC<{
  groups: SwarmConnectionGroup<SwarmNode>[];
  showEngineRowAccent: boolean;
  getColumnSortDirection: (field: string) => "asc" | "desc" | undefined;
  onColumnSort: (field: string) => void;
}> = ({ groups, showEngineRowAccent, getColumnSortDirection, onColumnSort }) => {
  const { t } = useTranslation();
  const columnCount = 7;
  const grouped = useGroupByConnection();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({
      groups,
      getRowKey: (node) => `${node.connectionId}:${node.ID}`,
      scrollKey: "swarm.nodes",
      grouped,
    });
  return (
    <div className="GroupedTableScroll" ref={scrollElementRef}>
      <HTMLTable
        compact
        interactive
        className="AppDataTable GroupedTable SwarmTable"
        data-windowed="true"
        data-table="swarm.nodes"
        data-grouped={grouped ? "true" : "false"}
      >
        <thead ref={theadRef}>
          <tr>
            <SortableColumnHeader field="hostname" direction={getColumnSortDirection("hostname")} onSort={onColumnSort}>
              <AppLabel iconName={IconNames.DIAGRAM_TREE} text={t("Hostname")} />
            </SortableColumnHeader>
            <SortableColumnHeader field="role" direction={getColumnSortDirection("role")} onSort={onColumnSort}>
              {t("Role")}
            </SortableColumnHeader>
            <SortableColumnHeader
              field="availability"
              direction={getColumnSortDirection("availability")}
              onSort={onColumnSort}
            >
              {t("Availability")}
            </SortableColumnHeader>
            <SortableColumnHeader field="state" direction={getColumnSortDirection("state")} onSort={onColumnSort}>
              {t("State")}
            </SortableColumnHeader>
            <SortableColumnHeader field="manager" direction={getColumnSortDirection("manager")} onSort={onColumnSort}>
              {t("Manager")}
            </SortableColumnHeader>
            <SortableColumnHeader field="engine" direction={getColumnSortDirection("engine")} onSort={onColumnSort}>
              {t("Engine")}
            </SortableColumnHeader>
            <th data-column="Actions">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <VirtualSpacerRow height={paddingTop} columnCount={columnCount} />
          {items.map(({ row: descriptor, index, key }) => {
            const striped = index % 2 === 0 ? "true" : undefined;
            if (descriptor.kind === "group-header") {
              return (
                <SwarmGroupHeaderRow
                  key={key}
                  group={descriptor.group as SwarmConnectionGroup<SwarmNode>}
                  columnCount={columnCount}
                  collapsed={isCollapsed(descriptor.groupKey)}
                  striped={striped}
                  showEngineRowAccent={showEngineRowAccent}
                  resourceSingular="node"
                  resourcePlural="nodes"
                  onGroupToggleClick={onGroupToggleClick}
                  measureRef={measureRef}
                  index={index}
                />
              );
            }
            const node = descriptor.item;
            const role = node.Spec?.Role ?? "worker";
            const availability = node.Spec?.Availability ?? "active";
            const leader = node.ManagerStatus?.Leader === true;
            const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
            return (
              <tr
                key={key}
                ref={measureRef}
                data-index={index}
                data-prefix-group={node.connectionId}
                data-striped={striped}
                data-node={node.ID}
                data-engine-row={showEngineRowAccent ? node.engine : undefined}
              >
                <td>
                  <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                    <div className="AppDataTableGroupLinkVertical" />
                    <div className="AppDataTableGroupLinkHorizontal" />
                  </div>
                  <AppDataTableLink
                    fillCell
                    href={getSwarmInspectUrl("nodes", node.ID, node.connectionId)}
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
                  <NodeActionsCell node={node} />
                </td>
              </tr>
            );
          })}
          <VirtualSpacerRow height={paddingBottom} columnCount={columnCount} />
        </tbody>
      </HTMLTable>
    </div>
  );
};

const GroupedStacksTable: React.FC<{
  groups: SwarmConnectionGroup<SwarmStack>[];
  showEngineRowAccent: boolean;
  getColumnSortDirection: (field: string) => "asc" | "desc" | undefined;
  onColumnSort: (field: string) => void;
}> = ({ groups, showEngineRowAccent, getColumnSortDirection, onColumnSort }) => {
  const { t } = useTranslation();
  const columnCount = 3;
  const grouped = useGroupByConnection();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({
      groups,
      getRowKey: (stack) => `${stack.connectionId}:${stack.Name}`,
      scrollKey: "swarm.stacks",
      grouped,
    });
  return (
    <div className="GroupedTableScroll" ref={scrollElementRef}>
      <HTMLTable
        compact
        interactive
        className="AppDataTable GroupedTable SwarmTable"
        data-windowed="true"
        data-table="swarm.stacks"
        data-grouped={grouped ? "true" : "false"}
      >
        <thead ref={theadRef}>
          <tr>
            <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={onColumnSort}>
              <AppLabel iconName={IconNames.LAYERS} text={t("Name")} />
            </SortableColumnHeader>
            <SortableColumnHeader field="services" direction={getColumnSortDirection("services")} onSort={onColumnSort}>
              {t("Services")}
            </SortableColumnHeader>
            <SortableColumnHeader
              field="orchestrator"
              direction={getColumnSortDirection("orchestrator")}
              onSort={onColumnSort}
            >
              {t("Orchestrator")}
            </SortableColumnHeader>
          </tr>
        </thead>
        <tbody>
          <VirtualSpacerRow height={paddingTop} columnCount={columnCount} />
          {items.map(({ row: descriptor, index, key }) => {
            const striped = index % 2 === 0 ? "true" : undefined;
            if (descriptor.kind === "group-header") {
              return (
                <SwarmGroupHeaderRow
                  key={key}
                  group={descriptor.group as SwarmConnectionGroup<SwarmStack>}
                  columnCount={columnCount}
                  collapsed={isCollapsed(descriptor.groupKey)}
                  striped={striped}
                  showEngineRowAccent={showEngineRowAccent}
                  resourceSingular="stack"
                  resourcePlural="stacks"
                  onGroupToggleClick={onGroupToggleClick}
                  measureRef={measureRef}
                  index={index}
                />
              );
            }
            const stack = descriptor.item;
            const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
            return (
              <tr
                key={key}
                ref={measureRef}
                data-index={index}
                data-prefix-group={stack.connectionId}
                data-striped={striped}
                data-stack={stack.Name}
                data-engine-row={showEngineRowAccent ? stack.engine : undefined}
              >
                <td>
                  <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                    <div className="AppDataTableGroupLinkVertical" />
                    <div className="AppDataTableGroupLinkHorizontal" />
                  </div>
                  <AppDataTableLink
                    fillCell
                    href={getSwarmInspectUrl("stacks", stack.Name, stack.connectionId)}
                    iconName={IconNames.LAYERS}
                    text={stack.Name}
                  />
                </td>
                <td>{stack.Services}</td>
                <td>{stack.Orchestrator}</td>
              </tr>
            );
          })}
          <VirtualSpacerRow height={paddingBottom} columnCount={columnCount} />
        </tbody>
      </HTMLTable>
    </div>
  );
};

const GroupedSecretsTable: React.FC<{
  groups: SwarmConnectionGroup<SwarmSecret>[];
  showEngineRowAccent: boolean;
  getColumnSortDirection: (field: string) => "asc" | "desc" | undefined;
  onColumnSort: (field: string) => void;
}> = ({ groups, showEngineRowAccent, getColumnSortDirection, onColumnSort }) => {
  const { t } = useTranslation();
  const columnCount = 3;
  const grouped = useGroupByConnection();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({
      groups,
      getRowKey: (secret) => `${secret.connectionId}:${secret.ID}`,
      scrollKey: "swarm.secrets",
      grouped,
    });
  return (
    <div className="GroupedTableScroll" ref={scrollElementRef}>
      <HTMLTable
        compact
        interactive
        className="AppDataTable GroupedTable SwarmTable"
        data-windowed="true"
        data-table="swarm.secrets"
        data-grouped={grouped ? "true" : "false"}
      >
        <thead ref={theadRef}>
          <tr>
            <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={onColumnSort}>
              <AppLabel iconName={IconNames.KEY} text={t("Name")} />
            </SortableColumnHeader>
            <SortableColumnHeader field="created" direction={getColumnSortDirection("created")} onSort={onColumnSort}>
              {t("Created")}
            </SortableColumnHeader>
            <th data-column="Actions">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <VirtualSpacerRow height={paddingTop} columnCount={columnCount} />
          {items.map(({ row: descriptor, index, key }) => {
            const striped = index % 2 === 0 ? "true" : undefined;
            if (descriptor.kind === "group-header") {
              return (
                <SwarmGroupHeaderRow
                  key={key}
                  group={descriptor.group as SwarmConnectionGroup<SwarmSecret>}
                  columnCount={columnCount}
                  collapsed={isCollapsed(descriptor.groupKey)}
                  striped={striped}
                  showEngineRowAccent={showEngineRowAccent}
                  resourceSingular="secret"
                  resourcePlural="secrets"
                  onGroupToggleClick={onGroupToggleClick}
                  measureRef={measureRef}
                  index={index}
                />
              );
            }
            const secret = descriptor.item;
            const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
            return (
              <tr
                key={key}
                ref={measureRef}
                data-index={index}
                data-prefix-group={secret.connectionId}
                data-striped={striped}
                data-secret={secret.ID}
                data-engine-row={showEngineRowAccent ? secret.engine : undefined}
              >
                <td>
                  <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                    <div className="AppDataTableGroupLinkVertical" />
                    <div className="AppDataTableGroupLinkHorizontal" />
                  </div>
                  <AppDataTableLink
                    fillCell
                    href={getSwarmInspectUrl("secrets", secret.ID, secret.connectionId)}
                    iconName={IconNames.EYE_OPEN}
                    text={secret.Spec?.Name || secret.ID}
                  />
                </td>
                <td>{secret.CreatedAt ? dayjs(secret.CreatedAt).format("DD MMM YYYY HH:mm") : "—"}</td>
                <td data-column="Actions">
                  <SecretActionsCell secret={secret} />
                </td>
              </tr>
            );
          })}
          <VirtualSpacerRow height={paddingBottom} columnCount={columnCount} />
        </tbody>
      </HTMLTable>
    </div>
  );
};

const GroupedConfigsTable: React.FC<{
  groups: SwarmConnectionGroup<SwarmConfig>[];
  showEngineRowAccent: boolean;
  getColumnSortDirection: (field: string) => "asc" | "desc" | undefined;
  onColumnSort: (field: string) => void;
}> = ({ groups, showEngineRowAccent, getColumnSortDirection, onColumnSort }) => {
  const { t } = useTranslation();
  const columnCount = 3;
  const grouped = useGroupByConnection();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({
      groups,
      getRowKey: (config) => `${config.connectionId}:${config.ID}`,
      scrollKey: "swarm.configs",
      grouped,
    });
  return (
    <div className="GroupedTableScroll" ref={scrollElementRef}>
      <HTMLTable
        compact
        interactive
        className="AppDataTable GroupedTable SwarmTable"
        data-windowed="true"
        data-table="swarm.configs"
        data-grouped={grouped ? "true" : "false"}
      >
        <thead ref={theadRef}>
          <tr>
            <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={onColumnSort}>
              <AppLabel iconName={IconNames.DOCUMENT} text={t("Name")} />
            </SortableColumnHeader>
            <SortableColumnHeader field="created" direction={getColumnSortDirection("created")} onSort={onColumnSort}>
              {t("Created")}
            </SortableColumnHeader>
            <th data-column="Actions">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <VirtualSpacerRow height={paddingTop} columnCount={columnCount} />
          {items.map(({ row: descriptor, index, key }) => {
            const striped = index % 2 === 0 ? "true" : undefined;
            if (descriptor.kind === "group-header") {
              return (
                <SwarmGroupHeaderRow
                  key={key}
                  group={descriptor.group as SwarmConnectionGroup<SwarmConfig>}
                  columnCount={columnCount}
                  collapsed={isCollapsed(descriptor.groupKey)}
                  striped={striped}
                  showEngineRowAccent={showEngineRowAccent}
                  resourceSingular="config"
                  resourcePlural="configs"
                  onGroupToggleClick={onGroupToggleClick}
                  measureRef={measureRef}
                  index={index}
                />
              );
            }
            const config = descriptor.item;
            const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
            return (
              <tr
                key={key}
                ref={measureRef}
                data-index={index}
                data-prefix-group={config.connectionId}
                data-striped={striped}
                data-config={config.ID}
                data-engine-row={showEngineRowAccent ? config.engine : undefined}
              >
                <td>
                  <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                    <div className="AppDataTableGroupLinkVertical" />
                    <div className="AppDataTableGroupLinkHorizontal" />
                  </div>
                  <AppDataTableLink
                    fillCell
                    href={getSwarmInspectUrl("configs", config.ID, config.connectionId)}
                    iconName={IconNames.EYE_OPEN}
                    text={config.Spec?.Name || config.ID}
                  />
                </td>
                <td>{config.CreatedAt ? dayjs(config.CreatedAt).format("DD MMM YYYY HH:mm") : "—"}</td>
                <td data-column="Actions">
                  <ConfigActionsCell config={config} />
                </td>
              </tr>
            );
          })}
          <VirtualSpacerRow height={paddingBottom} columnCount={columnCount} />
        </tbody>
      </HTMLTable>
    </div>
  );
};

// Exported so the Stack detail view (SwarmInspectScreen) reuses the same rich table (view link + scale +
// remove) for a stack's member services — no duplicate table.
export const ServicesTable: React.FC<{
  services: SwarmService[];
  connectionId: string;
  engine?: string;
  onScale: (id: string, replicas: number) => void;
  onRemove: (id: string) => void;
}> = ({ services, connectionId, engine, onScale, onRemove }) => {
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
            <tr key={service.ID} data-service={service.ID} data-engine-row={engine}>
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

Screen.ID = ID;
Screen.Title = i18n.t("Swarm");
Screen.Route = {
  Path: "/screens/swarm",
};
Screen.Metadata = {
  LeftIcon: IconNames.LAYERS,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.extensions.swarm === true;
};

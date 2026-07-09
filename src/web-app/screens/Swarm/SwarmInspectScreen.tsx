import { IconNames } from "@blueprintjs/icons";

import type { SwarmConfig, SwarmNode, SwarmSecret, SwarmService } from "@/env/Types";
import i18n from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { connectedConnections, isDockerConnection } from "@/web-app/components/ConnectionSelect";
import { ResourceInspectTabs } from "@/web-app/components/ResourceInspectTabs";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { buildSwarmSummary } from "./inspectSummary";
import { ServicesTable } from "./ManageScreen";
import { getSwarmCrumbs, getSwarmTabUrl, type SwarmInspectSegment } from "./Navigation";
import { type SwarmInspectKind, useRemoveService, useScaleService, useSwarmInspect, useSwarmServices } from "./queries";

export const ID = "swarm.inspect";
export const Title = i18n.t("Swarm Inspect");

const STACK_NAMESPACE_LABEL = "com.docker.stack.namespace";

const SEGMENT_TO_KIND: Record<Exclude<SwarmInspectSegment, "stacks">, SwarmInspectKind> = {
  services: "service",
  nodes: "node",
  configs: "config",
  secrets: "secret",
};

const SEGMENT_ICON: Record<SwarmInspectSegment, (typeof IconNames)[keyof typeof IconNames]> = {
  services: IconNames.LAYERS,
  nodes: IconNames.DIAGRAM_TREE,
  stacks: IconNames.LAYERS,
  secrets: IconNames.KEY,
  configs: IconNames.DOCUMENT,
};

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { kind, id } = useRouteParams<{ kind: SwarmInspectSegment; id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  // Swarm is Docker-only; when the URL has no connId, fall back to the first connected Docker connection
  // (NOT the active connector, which may be Podman) so the view targets a swarm-capable engine.
  const connectionId = connId || connectedConnections(connections, activeRuntime, isDockerConnection)[0]?.id || "";
  const icon = SEGMENT_ICON[kind] ?? IconNames.LAYERS;
  const listRoutePath = getSwarmTabUrl(kind, connectionId);

  const isStack = kind === "stacks";
  const inspectKind: SwarmInspectKind = isStack ? "service" : (SEGMENT_TO_KIND[kind] ?? "service");
  const entityQuery = useSwarmInspect(connectionId, inspectKind, isStack ? undefined : id);
  const servicesQuery = useSwarmServices(connectionId, isStack);
  const scaleService = useScaleService(connectionId);
  const removeService = useRemoveService(connectionId);

  // Stacks are derived (not a REST object) — reuse the Services table for the member services so a stack's
  // services get the same detail link + scale/remove actions.
  if (isStack) {
    const services = (servicesQuery.data ?? []).filter((s) => s.Spec?.Labels?.[STACK_NAMESPACE_LABEL] === id);
    return (
      <div className="AppScreen" data-screen={ID}>
        <AppScreenHeader
          withoutSearch
          withBack
          listRoutePath={listRoutePath}
          listRouteIcon={IconNames.LAYERS}
          titleText={id}
          titleIcon={icon}
          breadcrumbs={getSwarmCrumbs(kind, id, connectionId)}
        />
        <div className="AppScreenContent">
          {servicesQuery.isLoading ? (
            <ScreenLoader screen={ID} pending />
          ) : (
            <ServicesTable
              services={services}
              connectionId={connectionId}
              onScale={(serviceId, replicas) => scaleService.mutate({ id: serviceId, replicas })}
              onRemove={(serviceId) => removeService.mutate(serviceId)}
            />
          )}
        </div>
      </div>
    );
  }

  const entity = entityQuery.data as SwarmService | SwarmNode | SwarmConfig | SwarmSecret | undefined;
  if (!entity) {
    return <ScreenLoader screen={ID} pending={entityQuery.isLoading || entityQuery.isFetching} />;
  }
  const title = (entity as SwarmService).Spec?.Name || (entity as SwarmNode).Description?.Hostname || entity.ID || id;
  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        listRoutePath={listRoutePath}
        listRouteIcon={IconNames.LAYERS}
        titleText={title}
        titleIcon={icon}
        breadcrumbs={getSwarmCrumbs(kind, title, connectionId)}
      />
      <ResourceInspectTabs
        dataScreen={ID}
        summaryRows={buildSwarmSummary(entity, inspectKind)}
        summaryTable="swarm.inspect-summary"
        rawValue={JSON.stringify(entity, null, 2)}
      />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/swarm/$kind/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.LAYERS,
  ExcludeFromSidebar: true,
};

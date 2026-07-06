import { EngineDataService } from "@/platform/engineDataService";
import { ResourceSyncBroker, type ResourceSyncBrokerDeps } from "@/platform/resourceSyncBroker";

type ResourceSyncService = ResourceSyncBrokerDeps["service"];

export interface ElectronResourceSyncHost {
  service: ResourceSyncService;
  broker: ResourceSyncBroker;
  dispose: () => void;
}

export interface ElectronResourceSyncHostDeps extends Omit<ResourceSyncBrokerDeps, "service"> {
  service?: ResourceSyncService;
}

export function createResourceSyncHost(deps: ElectronResourceSyncHostDeps): ElectronResourceSyncHost {
  const service = deps.service ?? new EngineDataService();
  const broker = new ResourceSyncBroker({
    service,
    onInvoke: deps.onInvoke,
    onMessage: deps.onMessage,
    broadcast: deps.broadcast,
    isAllowedSender: deps.isAllowedSender,
  });
  broker.register();
  return {
    service,
    broker,
    dispose: () => broker.dispose(),
  };
}

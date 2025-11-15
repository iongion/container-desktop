import { Switch } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { ContainerEngine, type Registry, type RegistrySearchFilters } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useStoreState } from "@/web-app/domain/types";
import { pathTo } from "@/web-app/Navigator";
import "./ScreenHeader.css";

// Screen header
interface ScreenHeaderProps {
  searchTerm?: string;
  onSearch?: React.ChangeEventHandler<HTMLInputElement> | undefined;
  onSearchTrigger?: (filters: RegistrySearchFilters, event: any) => void;
  withSearchTrigger?: boolean;
  registry?: Registry;
  listRoutePath?: string;
  listRouteIcon?: IconName;
  rightContent?: React.ReactNode;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  searchTerm,
  onSearch,
  onSearchTrigger,
  withSearchTrigger,
  registry,
  listRoutePath,
  listRouteIcon,
  rightContent,
}: ScreenHeaderProps) => {
  const currentConnector = useStoreState((state) => state.currentConnector);
  const isOfficial = useStoreState((actions) => actions.registry.official);
  const isAutomated = useStoreState((actions) => actions.registry.automated);
  const [filters, setFilters] = useState<RegistrySearchFilters>({
    isOfficial,
    isAutomated,
  });
  let currentListRoutePath = listRoutePath;
  if (registry && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/registries");
  }
  const onSearchTriggered = useCallback(
    (e) => {
      if (onSearchTrigger) {
        onSearchTrigger(filters, e);
      }
    },
    [filters, onSearchTrigger],
  );
  const onFilterChange = useCallback(
    (e) => {
      const filter = e.currentTarget.getAttribute("data-filter");
      switch (filter) {
        case "isAutomated":
          filters.isAutomated = e.currentTarget.checked;
          break;
        case "isOfficial":
          filters.isOfficial = e.currentTarget.checked;
          break;
        default:
          break;
      }
      setFilters((prev) => ({ ...prev, ...filters }));
    },
    [filters],
  );

  return (
    <AppScreenHeader
      searchTerm={searchTerm}
      onSearch={onSearch}
      onSearchTrigger={onSearchTriggered}
      withSearchTrigger={withSearchTrigger}
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.GRAPH}
      rightContent={rightContent}
    >
      <div className="SearchFilters">
        <Switch
          label="Official"
          inline
          checked={filters.isOfficial}
          onChange={onFilterChange}
          data-filter="isOfficial"
        />
        <Switch
          label="Automated"
          inline
          checked={currentConnector?.engine === ContainerEngine.DOCKER ? false : filters.isAutomated}
          onChange={onFilterChange}
          data-filter="isAutomated"
          disabled={currentConnector?.engine === ContainerEngine.DOCKER}
        />
      </div>
    </AppScreenHeader>
  );
};

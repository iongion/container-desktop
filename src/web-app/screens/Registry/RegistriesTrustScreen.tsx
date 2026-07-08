import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useQueryClient } from "@tanstack/react-query";

import { t } from "@/web-app/App.i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { RegistriesPanel } from "./panels/RegistriesPanel";
import { useTrustStore } from "./trustStore";
import "./RegistriesTrust.css";

export const ID = "registries";

interface ScreenProps extends AppScreenProps {}

// Registries & Trust — the GLOBAL registries control center (merged across all connections, grouped by
// connection). A single section: the grouped registries table. Per-connection Certificates + Proxy now live in
// the connection edit form (Connections → edit), so this screen is just registries + its header CTAs (Search
// images · Add registry · Reload). Unified theme, NO ConnectionSelect. Occupies the "registries" sidebar slot.
export const Screen: AppScreen<ScreenProps> = () => {
  const qc = useQueryClient();
  const openDialog = useTrustStore((s) => s.openDialog);

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        rightContent={
          <ResourceListActions
            actions={{ icon: IconNames.PLUS, text: t("Add registry"), onClick: () => openDialog("add-registry") }}
            onReload={() => qc.invalidateQueries({ queryKey: ["registries"] })}
          />
        }
      >
        <div className="AppScreenHeaderText TrustHeaderText">
          <h5>{t("Configured registries")}</h5>
          <p className="TrustNote">
            {t(
              "Each engine has its own registries.conf + login (auth.json), so registries, insecure flags, mirrors, search order and auth are per connection.",
            )}
          </p>
        </div>
      </AppScreenHeader>
      <div className="AppScreenContent">
        <RegistriesPanel />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Registries";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: <ReactIcon.Icon className="ReactIcon" path={mdiCubeUnfolded} size={0.75} />,
};

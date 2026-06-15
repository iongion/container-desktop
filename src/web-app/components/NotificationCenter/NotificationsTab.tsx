import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { useActivityStore } from "@/web-app/stores/activityStore";
import { ActivityRow } from "./ActivityRow";
import { ActivityToolbar } from "./ActivityToolbar";
import { filterEntries } from "./activityFilters";

const TAB_KINDS = ["notification"] as const;

export function NotificationsTab() {
  const { t } = useTranslation();
  const entries = useActivityStore((state) => state.entries);
  const search = useActivityStore((state) => state.search.notifications);
  const filters = useActivityStore((state) => state.filters.notifications);

  const list = filterEntries(entries, {
    tabKinds: [...TAB_KINDS],
    kinds: filters.kinds,
    severities: filters.severities,
    search,
  });

  return (
    <div className="NotificationCenterPanel" data-tab="notifications">
      <ActivityToolbar tab="notifications" />
      <div className="ActivityListScroll">
        {list.length === 0 ? (
          <NonIdealState icon={IconNames.NOTIFICATIONS} title={t("No notifications yet")} />
        ) : (
          <div className="ActivityList">
            {list.map((entry) => (
              <ActivityRow key={entry.guid} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { useActivityStore } from "@/web-app/stores/activityStore";
import { ACTIVITY_TAB_KINDS } from "@/web-app/stores/activityTypes";
import { ActivityRow } from "./ActivityRow";
import { ActivityToolbar } from "./ActivityToolbar";
import { collapseConsecutiveDuplicates, filterEntries } from "./activityFilters";

export function ActivityTab() {
  const { t } = useTranslation();
  const entries = useActivityStore((state) => state.entries);
  const search = useActivityStore((state) => state.search.activity);
  const filters = useActivityStore((state) => state.filters.activity);

  const list = filterEntries(entries, {
    tabKinds: ACTIVITY_TAB_KINDS,
    kinds: filters.kinds,
    severities: filters.severities,
    search,
  });
  const rows = collapseConsecutiveDuplicates(list);

  return (
    <div className="NotificationCenterPanel" data-tab="activity">
      <ActivityToolbar tab="activity" showKinds />
      <div className="ActivityListScroll">
        {rows.length === 0 ? (
          <NonIdealState icon={IconNames.HISTORY} title={t("No activity recorded yet")} />
        ) : (
          <div className="ActivityList">
            {rows.map(({ entry, count }) => (
              <ActivityRow key={entry.guid} entry={entry} count={count} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

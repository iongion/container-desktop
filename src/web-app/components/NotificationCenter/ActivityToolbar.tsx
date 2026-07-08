import { type ActionProps, Button, ButtonGroup, InputGroup, type Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type ActivityTab, useActivityStore } from "@/web-app/stores/activityStore";
import {
  ACTIVITY_SEVERITIES,
  ACTIVITY_TAB_KINDS,
  type ActivityKind,
  type ActivitySeverity,
} from "@/web-app/stores/activityTypes";

const SEVERITY_ICON: Record<ActivitySeverity, ActionProps["icon"]> = {
  info: IconNames.INFO_SIGN,
  success: IconNames.TICK_CIRCLE,
  warning: IconNames.WARNING_SIGN,
  error: IconNames.ERROR,
};
const SEVERITY_INTENT: Record<ActivitySeverity, Intent> = {
  info: "primary",
  success: "success",
  warning: "warning",
  error: "danger",
};
const KIND_LABEL: Record<ActivityKind, string> = {
  notification: i18n.t("Notifications"),
  api: i18n.t("API"),
  cli: i18n.t("CLI"),
  system: i18n.t("System"),
};

// A single compact filter bar: the search field carries the kind + severity toggles as its
// right element. Pause/Clear actions live in the drawer header (see NotificationCenterHost).
export function ActivityToolbar({ tab, showKinds = false }: { tab: ActivityTab; showKinds?: boolean }) {
  const { t } = useTranslation();
  const search = useActivityStore((state) => state.search[tab]);
  const setSearch = useActivityStore((state) => state.setSearch);
  const filters = useActivityStore((state) => state.filters[tab]);
  const toggleKind = useActivityStore((state) => state.toggleKind);
  const toggleSeverity = useActivityStore((state) => state.toggleSeverity);

  const filterControls = (
    <div className="ActivityToolbarFilters">
      {showKinds ? (
        <ButtonGroup>
          {ACTIVITY_TAB_KINDS.map((kind) => (
            <Button
              key={kind}
              size="small"
              variant={filters.kinds.includes(kind) ? "solid" : "minimal"}
              text={t(KIND_LABEL[kind])}
              onClick={() => toggleKind(tab, kind)}
            />
          ))}
        </ButtonGroup>
      ) : null}
      <ButtonGroup>
        {ACTIVITY_SEVERITIES.map((severity) => (
          <Button
            key={severity}
            size="small"
            variant={filters.severities.includes(severity) ? "solid" : "minimal"}
            icon={SEVERITY_ICON[severity]}
            intent={SEVERITY_INTENT[severity]}
            title={t(severity)}
            aria-label={t(severity)}
            onClick={() => toggleSeverity(tab, severity)}
          />
        ))}
      </ButtonGroup>
    </div>
  );

  return (
    <div className="ActivityToolbar">
      <InputGroup
        className="ActivityToolbarSearch"
        size="small"
        fill
        leftIcon={IconNames.SEARCH}
        placeholder={t("Filter…")}
        value={search}
        onChange={(event) => setSearch(tab, event.target.value)}
        rightElement={filterControls}
      />
    </div>
  );
}

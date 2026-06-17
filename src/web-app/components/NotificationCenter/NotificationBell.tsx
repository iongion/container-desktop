import { Button, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { selectUnreadCount, useActivityStore } from "@/web-app/stores/activityStore";

// Only toggles store state (the drawer itself is mounted once in NotificationCenterHost). The bell icon
// is muted normally and switches to the engine accent when there are unread entries — the unread signal
// (no counter). Colors are theme-aware (see NotificationCenter.css), never hardcoded white.
export function NotificationBell() {
  const { t } = useTranslation();
  const toggleDrawer = useActivityStore((state) => state.toggleDrawer);
  const unread = useActivityStore(selectUnreadCount);

  return (
    <div className="NotificationBell">
      <Button
        className="NotificationBellButton"
        variant="minimal"
        icon={
          <Icon
            icon={IconNames.NOTIFICATIONS}
            className={unread > 0 ? "NotificationBellIcon NotificationBellIcon--unread" : "NotificationBellIcon"}
          />
        }
        onClick={toggleDrawer}
        title={t("Notifications & activity")}
        aria-label={t("Notifications & activity")}
      />
    </div>
  );
}

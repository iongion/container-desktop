import { Button, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { selectUnreadCount, useActivityStore } from "@/web-app/stores/activityStore";

// Only toggles store state (the drawer itself is mounted once in NotificationCenterHost). The bell icon
// fills white when there are unread entries and stays muted otherwise — the unread signal (no counter).
export function NotificationBell() {
  const { t } = useTranslation();
  const toggleDrawer = useActivityStore((state) => state.toggleDrawer);
  const unread = useActivityStore(selectUnreadCount);

  return (
    <div className="NotificationBell">
      <Button
        className="NotificationBellButton"
        variant="minimal"
        icon={<Icon icon={IconNames.NOTIFICATIONS} color={unread > 0 ? "#ffffff" : "#abb3bf"} />}
        onClick={toggleDrawer}
        title={t("Notifications & activity")}
        aria-label={t("Notifications & activity")}
      />
    </div>
  );
}

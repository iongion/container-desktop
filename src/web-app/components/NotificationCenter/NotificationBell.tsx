import { Button, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { selectUnreadCount, useActivityStore } from "@/web-app/stores/activityStore";

// Only toggles store state (the drawer itself is mounted once in NotificationCenterHost).
// Shows an unread badge for entries since last opened.
export function NotificationBell() {
  const { t } = useTranslation();
  const toggleDrawer = useActivityStore((state) => state.toggleDrawer);
  const unread = useActivityStore(selectUnreadCount);

  return (
    <div className="NotificationBell">
      <Button
        className="NotificationBellButton"
        variant="minimal"
        icon={IconNames.NOTIFICATIONS}
        onClick={toggleDrawer}
        title={t("Notifications & activity")}
        aria-label={t("Notifications & activity")}
      />
      {unread > 0 ? (
        <Tag className="NotificationBellBadge" round intent="danger">
          {unread > 99 ? "99+" : unread}
        </Tag>
      ) : null}
    </div>
  );
}

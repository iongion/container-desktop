import { Button, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { selectUnreadCount, useActivityStore } from "@/web-app/stores/activityStore";

// Lives in the per-screen footer; only toggles store state (the drawer itself is mounted
// once in NotificationCenterHost). Shows an unread badge for entries since last opened.
export function FooterBell() {
  const { t } = useTranslation();
  const toggleDrawer = useActivityStore((state) => state.toggleDrawer);
  const unread = useActivityStore(selectUnreadCount);

  return (
    <div className="FooterBell">
      <Button
        variant="minimal"
        size="small"
        icon={IconNames.NOTIFICATIONS}
        onClick={toggleDrawer}
        title={t("Notifications & activity")}
        aria-label={t("Notifications & activity")}
      />
      {unread > 0 ? (
        <Tag className="FooterBellBadge" round intent="danger">
          {unread > 99 ? "99+" : unread}
        </Tag>
      ) : null}
    </div>
  );
}

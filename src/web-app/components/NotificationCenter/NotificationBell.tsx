import { Button, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { selectHasError, selectUnreadCount, useActivityStore } from "@/web-app/stores/activityStore";

// Only toggles store state (the drawer itself is mounted once in NotificationCenterHost). The bell icon
// is muted normally, switches to the engine accent when there are unread entries, and goes DANGER (red)
// whenever any recorded entry is an error — so a failure can't be missed. Error beats unread. Colors are
// theme-aware (see NotificationCenter.css), never hardcoded white.
export function NotificationBell() {
  const { t } = useTranslation();
  const toggleDrawer = useActivityStore((state) => state.toggleDrawer);
  const unread = useActivityStore(selectUnreadCount);
  const hasError = useActivityStore(selectHasError);
  const iconClass = hasError
    ? "NotificationBellIcon NotificationBellIcon--error"
    : unread > 0
      ? "NotificationBellIcon NotificationBellIcon--unread"
      : "NotificationBellIcon";

  return (
    <div className="NotificationBell">
      <Button
        className="NotificationBellButton"
        variant="minimal"
        icon={<Icon icon={IconNames.NOTIFICATIONS} className={iconClass} />}
        onClick={toggleDrawer}
        title={t("Notifications & activity")}
        aria-label={t("Notifications & activity")}
      />
    </div>
  );
}

import { Button, ButtonGroup, Classes, Drawer, DrawerSize, Position, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ensureCliBusSubscribed, type ActivityTab as TabId, useActivityStore } from "@/web-app/stores/activityStore";
import { APP_DRAWER_BACKDROP_CLASS, APP_DRAWER_PORTAL_CLASS } from "../AppDrawer";
import { ActivityTab } from "./ActivityTab";
import { NotificationsTab } from "./NotificationsTab";
import "./NotificationCenter.css";

// Single, app-wide mount for the notification center drawer (mirrors FindHost). The
// header bell only toggles store state; the drawer + entries live here so
// they persist across navigation.
//
// A custom segmented switcher lives in the drawer header bar (as the title) — it reads
// better than the framework tabs and shows a per-tab count. The body renders only the
// active tab's content.
export function NotificationCenterHost() {
  const { t } = useTranslation();
  const isOpen = useActivityStore((state) => state.drawerOpen);
  const activeTab = useActivityStore((state) => state.activeTab);
  const setActiveTab = useActivityStore((state) => state.setActiveTab);
  const closeDrawer = useActivityStore((state) => state.closeDrawer);
  const paused = useActivityStore((state) => state.paused);
  const togglePause = useActivityStore((state) => state.togglePause);
  const clear = useActivityStore((state) => state.clear);
  const notificationCount = useActivityStore((state) =>
    state.entries.reduce((total, entry) => (entry.kind === "notification" ? total + 1 : total), 0),
  );
  const activityCount = useActivityStore((state) =>
    state.entries.reduce((total, entry) => (entry.kind === "notification" ? total : total + 1), 0),
  );

  // Subscribe to the preload CLI bridge once the bridge is available (covers the case where
  // the store module evaluated before window.ActivityBus was exposed).
  useEffect(() => {
    ensureCliBusSubscribed();
  }, []);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "notifications", label: t("Notifications"), count: notificationCount },
    { id: "activity", label: t("Activity"), count: activityCount },
  ];

  return (
    <Drawer
      className="AppDrawer NotificationCenterDrawer"
      position={Position.RIGHT}
      size={DrawerSize.SMALL}
      hasBackdrop={false}
      usePortal
      portalClassName={APP_DRAWER_PORTAL_CLASS}
      backdropClassName={APP_DRAWER_BACKDROP_CLASS}
      isOpen={isOpen}
      onClose={closeDrawer}
      icon={IconNames.NOTIFICATIONS}
      title={
        <div className="NotificationCenterHeaderBar">
          <ButtonGroup className="NotificationCenterSwitch">
            {tabs.map((tab) => (
              <Button key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
                <Tag round minimal className="NotificationCenterSwitchCount">
                  {tab.count > 99 ? "99+" : tab.count}
                </Tag>
              </Button>
            ))}
          </ButtonGroup>
          <div className="NotificationCenterHeaderActions">
            {activeTab === "activity" ? (
              <Button
                variant={paused ? "solid" : "minimal"}
                size="small"
                intent={paused ? "warning" : "none"}
                icon={paused ? IconNames.PLAY : IconNames.PAUSE}
                title={paused ? t("Resume recording") : t("Pause recording")}
                aria-label={paused ? t("Resume recording") : t("Pause recording")}
                onClick={togglePause}
              />
            ) : null}
            <Button
              variant="minimal"
              size="small"
              icon={IconNames.TRASH}
              title={t("Clear")}
              aria-label={t("Clear activity")}
              onClick={() => clear(activeTab)}
            />
          </div>
        </div>
      }
    >
      <div className={Classes.DRAWER_BODY}>
        {activeTab === "notifications" ? <NotificationsTab /> : <ActivityTab />}
      </div>
    </Drawer>
  );
}

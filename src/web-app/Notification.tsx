import { type Intent, OverlayToaster, Position } from "@blueprintjs/core";

import { systemNotifier } from "@/container-client/notifier";
import "./Notification.css";

const Toaster = await OverlayToaster.create({
  className: "AppToaster NotificationAppToaster",
  position: Position.TOP_RIGHT,
  usePortal: true,
});

export const Notification = {
  show: ({ message, intent = "success", timeout = 3000 }: { message: string; intent: Intent; timeout?: number }) => {
    Toaster.show({ message, intent, timeout });
    // Tee every toast into the in-memory activity bus so the Notification Center keeps a
    // history. The ~70 existing call sites are unchanged — this is the single emit point.
    systemNotifier.transmit("activity.notification", { message, intent });
  },
};

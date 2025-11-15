import { type Intent, OverlayToaster, Position } from "@blueprintjs/core";

import "./Notification.css";

const Toaster = await OverlayToaster.create({
  className: "AppToaster NotificationAppToaster",
  position: Position.TOP_RIGHT,
  usePortal: true,
});

export const Notification = {
  show: ({ message, intent = "success", timeout = 3000 }: { message: string; intent: Intent; timeout?: number }) => {
    console.debug("Notification.show", { message, intent, timeout });
    Toaster.show({ message, intent, timeout });
  },
};

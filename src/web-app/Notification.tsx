import { Position, Toaster } from "@blueprintjs/core";

import "./Notification.css";

export const Notification = Toaster.create({
  className: "AppToaster NotificationAppToaster",
  position: Position.TOP_RIGHT,
  usePortal: true
});

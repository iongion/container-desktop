import { type Intent, OverlayToaster, Position } from "@blueprintjs/core";

import { systemNotifier } from "@/container-client/notifier";
import "./Notification.css";

const Toaster = await OverlayToaster.create({
  className: "AppToaster NotificationAppToaster",
  position: Position.TOP_RIGHT,
  usePortal: true,
});

export const Notification = {
  show: ({
    message,
    intent = "success",
    timeout = 3000,
    silent = false,
    detail,
  }: {
    message: string;
    intent: Intent;
    timeout?: number;
    silent?: boolean;
    detail?: string;
  }) => {
    // `silent` records the entry in the Notification Center but suppresses the popup toast — used for routine
    // boot / auto-start connection failures so they don't burst as toasts. Only the toast is suppressed.
    if (!silent) {
      Toaster.show({ message, intent, timeout });
    }
    // Tee every notification into the in-memory activity bus so the Notification Center keeps a history —
    // including any raw `detail` (a connection failure's "what it tried / what happened" + SSH preflight),
    // rendered expandably. The ~70 existing call sites are unchanged — this is the single emit point.
    systemNotifier.transmit("activity.notification", { message, intent, detail });
  },
};

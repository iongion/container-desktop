import { type Intent, OverlayToaster, Position } from "@blueprintjs/core";

import { systemNotifier } from "@/container-client/notifier";
import "./Notification.css";

// Create the Blueprint toaster lazily on first use instead of at module scope (top-level await). A module-
// scope `await OverlayToaster.create(...)` blocked the ENTIRE renderer boot chain until the toaster mounted
// and painted — but the window is created hidden (show:false) and backgroundThrottling:true, so on a degraded
// GPU/compositor the toaster never resolves, the renderer never reaches the `notify {ready}` IPC, and the
// window is never revealed → chicken-and-egg deadlock → 20s silent hang → recovery dialog.
let toasterPromise: ReturnType<typeof OverlayToaster.create> | undefined;
const getToaster = () =>
  (toasterPromise ??= OverlayToaster.create({
    className: "AppToaster NotificationAppToaster",
    position: Position.TOP_RIGHT,
    usePortal: true,
  }));

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
      void getToaster()
        .then((t) => t.show({ message, intent, timeout }))
        .catch(() => {});
    }
    // Tee every notification into the in-memory activity bus so the Notification Center keeps a history —
    // including any raw `detail` (a connection failure's "what it tried / what happened" + SSH preflight),
    // rendered expandably. The ~70 existing call sites are unchanged — this is the single emit point.
    systemNotifier.transmit("activity.notification", { message, intent, detail });
  },
};

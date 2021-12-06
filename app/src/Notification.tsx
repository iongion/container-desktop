import { Toaster, Position } from "@blueprintjs/core";

export const Notification = Toaster.create({
  className: "AppToaster",
  position: Position.TOP_RIGHT,
  usePortal: true
});

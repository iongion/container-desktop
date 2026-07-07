import { Icon, type IconName } from "@blueprintjs/core";

// Shared status pill for the Registries & Trust tables (TLS · authentication · certificate status). One
// element, four intents, matching the agreed mockup .pill (ok / warn / err / off). Theme-token colored in CSS.
export type TrustPillTone = "ok" | "warn" | "err" | "off";

export function TrustPill({
  tone,
  icon,
  children,
}: {
  tone: TrustPillTone;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <span className={`TrustPill TrustPill--${tone}`}>
      {icon ? <Icon icon={icon} size={11} /> : null}
      {children}
    </span>
  );
}

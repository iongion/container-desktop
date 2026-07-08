import i18n from "@/i18n";

import "./LiveLogBadge.css";

export type LogStatus = "connecting" | "live" | "ended" | "error" | "snapshot";

export interface LogBadgeDescriptor {
  label: string;
  tone: LogStatus;
  pulsing: boolean;
}

export function describeLogStatus(status: LogStatus): LogBadgeDescriptor {
  switch (status) {
    case "live":
      return { label: i18n.t("LIVE"), tone: "live", pulsing: true };
    case "connecting":
      return { label: i18n.t("CONNECTING"), tone: "connecting", pulsing: true };
    case "ended":
      return { label: i18n.t("ENDED"), tone: "ended", pulsing: false };
    case "error":
      return { label: i18n.t("ERROR"), tone: "error", pulsing: false };
    default:
      return { label: i18n.t("SNAPSHOT"), tone: "snapshot", pulsing: false };
  }
}

export const LiveLogBadge: React.FC<{ status: LogStatus }> = ({ status }) => {
  const { label, tone, pulsing } = describeLogStatus(status);
  return (
    <div className="LiveLogBadge" data-tone={tone} data-pulsing={pulsing} aria-live="polite">
      <span className="LiveLogBadgeDot" />
      <span className="LiveLogBadgeLabel">{label}</span>
    </div>
  );
};

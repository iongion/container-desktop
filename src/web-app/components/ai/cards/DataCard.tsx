// Card for data a plugin published for the GUI — `pi.appendEntry(customType, data)` or a custom
// `pi.sendMessage`. Its customType is the card key, and until a card claims that type the payload renders as
// inspectable JSON with the message text above it, so a plugin's output is never blank and never silently
// dropped.
import { IconNames } from "@blueprintjs/icons";

import { redactPayload } from "@/ai-system/core/redact";

import { AICardShell } from "./AICardShell";

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface DataCardProps {
  customType: string;
  data?: unknown;
  text?: string;
}

export const DataCard: React.FC<DataCardProps> = ({ customType, data, text }) => (
  <AICardShell title={customType} icon={IconNames.CUBE}>
    {text ? <pre className="AICardLogs">{text}</pre> : null}
    {data !== undefined && data !== null ? <pre className="AICardJson">{safeJson(redactPayload(data))}</pre> : null}
  </AICardShell>
);

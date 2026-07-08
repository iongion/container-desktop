import dayjs from "dayjs";

import { t } from "@/i18n";

// Translated Yes/No for boolean summary rows (Network internal/ipv6, Machine rootful, …).
export function yesNo(value: boolean | undefined | null): string {
  return value ? t("Yes") : t("No");
}

// First 12 characters of an id, with any leading `sha256:` stripped — matches the "Id" column the
// list screens show (title "First 12 characters"). Safe on undefined/null.
export function shortId(id: string | undefined | null): string {
  return (id ?? "").replace(/^sha256:/, "").slice(0, 12);
}

// The human date used across every inspect summary. Engine payloads are inconsistent — the same
// "Created" field arrives as epoch seconds (Podman list), epoch millis, or an ISO-8601 string (Docker
// inspect, sometimes with nanosecond precision). Multiplying an ISO string by 1000 is how you get
// "Invalid Date", so this normalizes all three and, if it still can't parse, RETURNS THE RAW VALUE
// rather than "Invalid Date". Returns "" for empty input so callers can omit the row.
export function inspectDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  // Numbers (or all-digit strings) are epoch: < 1e12 → seconds, else millis. Everything else → ISO/string.
  const digits = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value) : null;
  const parsed = digits !== null ? dayjs(digits < 1e12 ? digits * 1000 : digits) : dayjs(value);
  return parsed.isValid() ? parsed.format("DD MMM YYYY HH:mm") : String(value);
}

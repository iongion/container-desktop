import { H5, HTMLTable } from "@blueprintjs/core";
import type React from "react";

import { t } from "@/i18n";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { CopyButton } from "@/web-app/components/CopyButton";

import "./InspectSummary.css";

export interface InspectSummaryRow {
  // Stable React key for the row.
  key: string;
  // Already-translated property label (left column).
  label: string;
  // Already-formatted display value (prettyBytes / dayjs / yes-no / plain text).
  value: React.ReactNode;
  // When set, a CopyButton copying this raw text is rendered before the value.
  copyText?: string;
  // Monospace the value cell (ids, digests, paths, mountpoints).
  mono?: boolean;
}

export interface InspectSummaryProps {
  rows: InspectSummaryRow[];
  // Per-screen table id for CSS hooks / test targeting, e.g. "image.inspect-summary".
  dataTable: string;
}

// The shared human-friendly Property/Value summary shown above the raw JSON on every Inspect screen.
// Extracted from the inline table on ConnectionInfoScreen so all inspects share one implementation and
// look. Callers omit absent/engine-specific rows entirely (no "—" placeholders).
export function InspectSummary({ rows, dataTable }: InspectSummaryProps) {
  return (
    <HTMLTable compact striped interactive className="AppDataTable InspectSummary" data-table={dataTable}>
      <thead>
        <tr>
          <th data-column="Property">{t("Property")}</th>
          <th data-column="Value">{t("Value")}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>
              <code>{row.label}</code>
            </td>
            <td className={row.mono ? "InspectSummaryValue InspectSummaryValue--mono" : "InspectSummaryValue"}>
              {row.copyText === undefined ? null : (
                <>
                  <CopyButton text={row.copyText} />
                  &nbsp;
                </>
              )}
              {row.value}
            </td>
            <td></td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
}

export interface InspectRawJsonProps {
  // The pre-stringified JSON, i.e. JSON.stringify(resource, null, 2).
  value: string;
  // Section header above the viewer; defaults to "Raw configuration".
  title?: React.ReactNode;
}

// The raw-JSON viewer block (section header + bordered Monaco) shown below the summary. Centralizes the
// <H5> + framed-editor markup ConnectionInfoScreen does inline so every inspect matches.
export function InspectRawJson({ value, title }: InspectRawJsonProps) {
  return (
    <>
      <H5 className="InspectSectionTitle">{title ?? t("Raw configuration")}</H5>
      <div className="CodeEditor InspectCodeEditor">
        <CodeEditor value={value} />
      </div>
    </>
  );
}

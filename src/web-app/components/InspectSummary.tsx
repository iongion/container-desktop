import { H5 } from "@blueprintjs/core";
import type React from "react";

import { t } from "@/i18n";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { PropertyValueTable, type PropertyValueTableRow } from "@/web-app/components/PropertyValueTable";

import "./InspectSummary.css";

export type InspectSummaryRow = PropertyValueTableRow;

export interface InspectSummaryProps {
  rows: InspectSummaryRow[];
  // Per-screen table id for CSS hooks / test targeting, e.g. "image.inspect-summary".
  dataTable: string;
}

// The shared human-friendly Property/Value summary shown above the raw JSON on every Inspect screen.
// Extracted from the inline table on ConnectionInfoScreen so all inspects share one implementation and
// look. Callers omit absent/engine-specific rows entirely (no "—" placeholders).
export function InspectSummary({ rows, dataTable }: InspectSummaryProps) {
  return <PropertyValueTable rows={rows} dataTable={dataTable} className="InspectSummary" />;
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

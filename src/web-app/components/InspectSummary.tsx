import type React from "react";

import { JsonView } from "@/web-app/components/JsonView";
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

// The raw-JSON viewer block shown below the summary. Delegates to the reusable JsonView (Tree | JSON
// toggle), passing the Inspect header/frame classes so the existing section styling + height bounds apply.
export function InspectRawJson({ value, title }: InspectRawJsonProps) {
  return (
    <JsonView value={value} title={title} headerClassName="InspectSectionTitle" frameClassName="InspectCodeEditor" />
  );
}

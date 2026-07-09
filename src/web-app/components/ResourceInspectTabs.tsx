import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { type InspectTabSection, InspectTabs } from "@/web-app/components/InspectTabs";
import type { PropertyValueTableRow } from "@/web-app/components/PropertyValueTable";

export interface ResourceInspectTabsProps {
  // Screen id for CSS/test hooks, e.g. "image.inspect".
  dataScreen: string;
  // Rows for the Summary (rendered by the sortable PropertyValueTable via InspectSummary).
  summaryRows: PropertyValueTableRow[];
  // dataTable id for the Summary table, e.g. "image.inspect-summary".
  summaryTable: string;
  // Pre-stringified JSON for the Raw configuration (Tree | JSON viewer).
  rawValue: string;
  // Optional sections shown between Summary and Raw (Env vars / Ports / Mounts / …). When present, the screen
  // switches to the left tab rail; when absent, Summary + Raw simply stack (no wasted 2-item rail).
  middle?: InspectTabSection[];
  defaultTab?: string;
}

// Standard resource Inspect content, rendered inside its own .AppScreenContent so screens stay a thin
// header + this. With NO extra tabs it STACKS the Summary table above the Raw viewer (a 2-item rail would be
// wasted chrome). With extra tabs (Env/Ports/Mounts) it switches to the left tab rail: Summary, the middle
// tabs, then Raw configuration.
export function ResourceInspectTabs({
  dataScreen,
  summaryRows,
  summaryTable,
  rawValue,
  middle = [],
  defaultTab,
}: ResourceInspectTabsProps) {
  const { t } = useTranslation();
  const summary = <InspectSummary rows={summaryRows} dataTable={summaryTable} />;
  const raw = <InspectRawJson value={rawValue} />;

  if (middle.length === 0) {
    return (
      <div className="AppScreenContent">
        {summary}
        {raw}
      </div>
    );
  }

  const sections: InspectTabSection[] = [
    { id: "summary", label: t("Summary"), icon: IconNames.PROPERTIES, body: summary },
    ...middle,
    { id: "raw", label: t("Raw configuration"), icon: IconNames.CODE, body: raw },
  ];
  return (
    <div className="AppScreenContent InspectTabsContent">
      <InspectTabs sections={sections} dataScreen={dataScreen} defaultTab={defaultTab} />
    </div>
  );
}

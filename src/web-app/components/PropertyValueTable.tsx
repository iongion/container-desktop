import { HTMLTable, Icon, Tag } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import type React from "react";
import { useMemo } from "react";

import { t } from "@/i18n";
import { CopyButton } from "@/web-app/components/CopyButton";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { StatePill } from "@/web-app/components/StatePill";
import { StatusDot } from "@/web-app/components/StatusDot";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import type { StatusTone } from "@/web-app/screens/Container/health";
import type { SortSpec } from "@/web-app/stores/sortStore";
import { compareSortValues } from "@/web-app/utils/comparators";

import "./PropertyValueTable.css";

export type PropertyValueSortField = "property" | "value";

// How the value cell renders a row's (already-formatted) value. Only state/health/tag get special treatment
// (StatePill / health StatusDot / Blueprint Tag); every other hint — and no hint — renders the raw value, so
// plain rows (env vars, mounts, ids) are unaffected.
export type PropertyValueRenderHint = "plain" | "state" | "health" | "tag" | "code" | "date" | "bytes" | "yesno";

export interface PropertyValueTableRow {
  // Stable React key for the row.
  key: string;
  // Already-translated property label (left column).
  label: string;
  // Already-formatted display value (prettyBytes / dayjs / yes-no / plain text).
  value: React.ReactNode;
  // Optional raw text for copying when the rendered value is not plain text.
  copyText?: string;
  // Monospace the value cell (ids, digests, paths, mountpoints).
  mono?: boolean;
  // Optional presentation hint for the value cell (state pill / health dot / tag).
  render?: PropertyValueRenderHint;
  // Optional status tone for render:"health".
  tone?: StatusTone;
}

export interface PropertyValueTableProps {
  rows: PropertyValueTableRow[];
  // Per-screen table id for CSS hooks / test targeting, e.g. "image.inspect-summary".
  dataTable: string;
  className?: string;
  // Column header labels (default "Property" / "Value"). Ports/Mounts relabel to "Container" / "Host" — the
  // sort still keys on the label column ("property") and value column ("value").
  propertyLabel?: string;
  valueLabel?: string;
  // Optional leading icon in each column header.
  propertyIcon?: IconName;
  valueIcon?: IconName;
  // Sortable columns (default true). Set false for small fixed lists (e.g. container Ports).
  sortable?: boolean;
}

const DEFAULT_PROPERTY_VALUE_SORT: SortSpec = { field: "property", dir: "asc" };

export function propertyValueCopyText(value: React.ReactNode, copyText?: string): string {
  if (copyText !== undefined) {
    return copyText;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }
  return "";
}

export function sortPropertyValueRows(
  rows: PropertyValueTableRow[],
  sort: SortSpec | undefined,
): PropertyValueTableRow[] {
  const activeSort = sort ?? DEFAULT_PROPERTY_VALUE_SORT;
  const direction = activeSort.dir === "asc" ? 1 : -1;
  if (activeSort.field === "property") {
    return [...rows].sort((a, b) => direction * compareSortValues(a.label, b.label));
  }
  if (activeSort.field === "value") {
    return [...rows].sort(
      (a, b) =>
        direction *
        compareSortValues(propertyValueCopyText(a.value, a.copyText), propertyValueCopyText(b.value, b.copyText)),
    );
  }

  return rows;
}

// Value cell renderer — see PropertyValueRenderHint. Consumes the already-formatted row.value verbatim.
function renderPropertyValue(row: PropertyValueTableRow): React.ReactNode {
  switch (row.render) {
    case "state":
      return <StatePill state={String(row.value)} />;
    case "health":
      return <StatusDot tone={row.tone ?? "muted"} label={row.value} />;
    case "tag":
      return (
        <Tag minimal round className="PropertyValueTag">
          {row.value}
        </Tag>
      );
    default:
      return row.value;
  }
}

function headerContent(label: string, icon?: IconName): React.ReactNode {
  if (!icon) {
    return label;
  }
  return (
    <span className="PropertyValueHeaderCell">
      <Icon icon={icon} size={12} className="PropertyValueHeaderIcon" />
      {label}
    </span>
  );
}

export function PropertyValueTable({
  rows,
  dataTable,
  className,
  propertyLabel,
  valueLabel,
  propertyIcon,
  valueIcon,
  sortable = true,
}: PropertyValueTableProps) {
  const sortCapabilities = useMemo(() => ({ [`${dataTable}.*`]: "client" as const }), [dataTable]);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(dataTable, sortCapabilities);
  const activeSort = clientSort ?? DEFAULT_PROPERTY_VALUE_SORT;
  const sortedRows = useMemo(
    () => (sortable ? sortPropertyValueRows(rows, clientSort) : rows),
    [rows, clientSort, sortable],
  );
  const classes = ["AppDataTable", "PropertyValueTable", className].filter(Boolean).join(" ");
  const getSortDirection = (field: PropertyValueSortField) =>
    activeSort.field === field ? activeSort.dir : getColumnSortDirection(field);
  const propertyHeader = headerContent(propertyLabel ?? t("Property"), propertyIcon);
  const valueHeader = headerContent(valueLabel ?? t("Value"), valueIcon);

  return (
    <HTMLTable compact striped interactive className={classes} data-table={dataTable}>
      <thead>
        <tr>
          {sortable ? (
            <>
              <SortableColumnHeader field="property" direction={getSortDirection("property")} onSort={toggleColumnSort}>
                {propertyHeader}
              </SortableColumnHeader>
              <SortableColumnHeader field="value" direction={getSortDirection("value")} onSort={toggleColumnSort}>
                {valueHeader}
              </SortableColumnHeader>
            </>
          ) : (
            <>
              <th className="PropertyValueTableHeader PropertyValueTableProperty">
                <span className="PropertyValueHeaderInner">{propertyHeader}</span>
              </th>
              <th className="PropertyValueTableHeader">
                <span className="PropertyValueHeaderInner">{valueHeader}</span>
              </th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => {
          const copyText = propertyValueCopyText(row.value, row.copyText);
          return (
            <tr key={row.key}>
              <td className="PropertyValueTableProperty">
                <code>{row.label}</code>
              </td>
              <td
                className={
                  row.mono ? "PropertyValueTableValue PropertyValueTableValue--mono" : "PropertyValueTableValue"
                }
              >
                <CopyButton text={copyText} />
                &nbsp;
                {renderPropertyValue(row)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
}

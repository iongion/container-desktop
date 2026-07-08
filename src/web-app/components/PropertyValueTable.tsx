import { HTMLTable } from "@blueprintjs/core";
import type React from "react";
import { useMemo } from "react";

import { t } from "@/i18n";
import { CopyButton } from "@/web-app/components/CopyButton";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import type { SortSpec } from "@/web-app/stores/sortStore";
import { compareSortValues } from "@/web-app/utils/comparators";

import "./PropertyValueTable.css";

export type PropertyValueSortField = "property" | "value";

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
}

export interface PropertyValueTableProps {
  rows: PropertyValueTableRow[];
  // Per-screen table id for CSS hooks / test targeting, e.g. "image.inspect-summary".
  dataTable: string;
  className?: string;
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

export function PropertyValueTable({ rows, dataTable, className }: PropertyValueTableProps) {
  const sortCapabilities = useMemo(() => ({ [`${dataTable}.*`]: "client" as const }), [dataTable]);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(dataTable, sortCapabilities);
  const activeSort = clientSort ?? DEFAULT_PROPERTY_VALUE_SORT;
  const sortedRows = useMemo(() => sortPropertyValueRows(rows, clientSort), [rows, clientSort]);
  const classes = ["AppDataTable", "PropertyValueTable", className].filter(Boolean).join(" ");
  const getSortDirection = (field: PropertyValueSortField) =>
    activeSort.field === field ? activeSort.dir : getColumnSortDirection(field);

  return (
    <HTMLTable compact striped interactive className={classes} data-table={dataTable}>
      <thead>
        <tr>
          <SortableColumnHeader field="property" direction={getSortDirection("property")} onSort={toggleColumnSort}>
            {t("Property")}
          </SortableColumnHeader>
          <SortableColumnHeader field="value" direction={getSortDirection("value")} onSort={toggleColumnSort}>
            {t("Value")}
          </SortableColumnHeader>
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
                {row.value}
              </td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
}

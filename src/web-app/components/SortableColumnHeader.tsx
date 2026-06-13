import { Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";

import "./SortableColumnHeader.css";

export interface SortableColumnHeaderProps {
  field: string;
  direction?: "asc" | "desc";
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  onSort: (field: string) => void;
}

export function SortableColumnHeader({
  field,
  direction,
  disabled,
  title,
  children,
  onSort,
}: SortableColumnHeaderProps) {
  const icon = direction === "asc" ? IconNames.SORT_ASC : direction === "desc" ? IconNames.SORT_DESC : IconNames.SORT;
  const onSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onSort(event.currentTarget.dataset.sortField || field);
  };
  return (
    <th
      data-column={field}
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        className="SortableColumnHeaderButton"
        disabled={disabled}
        title={title}
        data-sort-field={field}
        data-sort-active={direction ? "yes" : "no"}
        onClick={onSortClick}
      >
        <span className="SortableColumnHeaderLabel">{children}</span>
        <Icon className="SortableColumnHeaderIcon" icon={icon} size={12} />
      </button>
    </th>
  );
}

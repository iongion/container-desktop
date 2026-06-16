// components/Bulk/SelectionCheckbox.tsx — the checkbox used in the select-all header cell and per-row
// cells. Stops click propagation so it never triggers the row's hover/focus/overlay handlers.

import { Checkbox } from "@blueprintjs/core";

interface SelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
}

export const SelectionCheckbox: React.FC<SelectionCheckboxProps> = ({ checked, indeterminate, onChange, title }) => (
  <Checkbox
    className="BulkSelectionCheckbox"
    checked={checked}
    indeterminate={indeterminate}
    onChange={() => onChange()}
    onClick={(e) => e.stopPropagation()}
    title={title}
  />
);

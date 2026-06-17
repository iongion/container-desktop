// components/Bulk/BulkActionsBar.tsx — the inline bulk-action controls shown in a list screen's header
// (next to Search + the Select toggle) while select mode is on. Lifecycle actions are minimal icon-only
// buttons (label as tooltip) to save horizontal space; the destructive Remove keeps its label, sits after
// a divider, and confirms via a Yes/No PopoverNext (the same popover-confirm pattern as ConfirmMenu — no
// dialogs). Each button is disabled when no selected item is eligible. After any run it refreshes the list
// once and clears the selection. Exiting select mode is handled by the Select toggle, so there is no Done.

import { Button, ButtonGroup, Divider, Intent, PopoverNext } from "@blueprintjs/core";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BulkAction } from "./types";
import { useBulkRunner } from "./useBulkRunner";
import "./BulkActionsBar.css";

interface BulkActionsBarProps<T> {
  items: T[];
  getId: (item: T) => string;
  selectedIds: Set<string>;
  // Either a fixed list, or a function of the current selection so screens can render state-aware
  // controls (e.g. a single play/pause toggle whose icon depends on the selected containers' states).
  actions: BulkAction<T>[] | ((selected: T[]) => BulkAction<T>[]);
  onClear: () => void;
  refresh: () => Promise<void> | void;
}

export function BulkActionsBar<T>({ items, getId, selectedIds, actions, onClear, refresh }: BulkActionsBarProps<T>) {
  const { t } = useTranslation();
  const { run, runningKey } = useBulkRunner<T>();
  const [confirmKey, setConfirmKey] = useState<string | undefined>();

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(getId(item))),
    [items, getId, selectedIds],
  );
  const resolvedActions = useMemo(
    () => (typeof actions === "function" ? actions(selectedItems) : actions),
    [actions, selectedItems],
  );

  const execute = useCallback(
    async (action: BulkAction<T>) => {
      const eligible = selectedItems.filter(action.eligible);
      if (eligible.length === 0) {
        return;
      }
      await run(action, eligible);
      await refresh();
      onClear();
    },
    [selectedItems, run, refresh, onClear],
  );

  const busy = runningKey !== undefined;
  const count = selectedItems.length;

  const renderButton = (action: BulkAction<T>, eligibleCount: number) => (
    <Button
      size="small"
      variant={action.destructive ? undefined : "minimal"}
      data-bulk-action={action.key}
      icon={action.icon}
      intent={action.intent}
      text={action.destructive ? action.label : undefined}
      disabled={busy || eligibleCount === 0}
      loading={runningKey === action.key}
      title={
        eligibleCount === 0
          ? t("No selected items are eligible for {{label}}", { label: action.label })
          : t("{{label}} {{eligibleCount}} of {{count}}", { label: action.label, eligibleCount, count })
      }
      onClick={() => (action.destructive ? setConfirmKey(action.key) : void execute(action))}
    />
  );

  const renderAction = (action: BulkAction<T>) => {
    const eligibleCount = selectedItems.filter(action.eligible).length;
    if (!action.destructive) {
      return <span key={action.key}>{renderButton(action, eligibleCount)}</span>;
    }
    return (
      <PopoverNext
        key={action.key}
        isOpen={confirmKey === action.key}
        onInteraction={(next) => setConfirmKey(next ? action.key : undefined)}
        usePortal
        hasBackdrop={false}
        placement="bottom-end"
        content={
          <div className="BulkConfirmPopover">
            <span className="BulkConfirmPopoverText">
              {t("{{label}} {{count}} selected?", { label: action.label, count: eligibleCount })}
            </span>
            <ButtonGroup>
              <Button
                size="small"
                variant="minimal"
                intent={Intent.DANGER}
                text={t("Yes")}
                data-bulk-confirm="yes"
                onClick={() => {
                  setConfirmKey(undefined);
                  void execute(action);
                }}
              />
              <Button
                size="small"
                variant="minimal"
                intent={Intent.SUCCESS}
                text={t("No")}
                data-bulk-confirm="no"
                onClick={() => setConfirmKey(undefined)}
              />
            </ButtonGroup>
          </div>
        }
      >
        {renderButton(action, eligibleCount)}
      </PopoverNext>
    );
  };

  const lifecycle = resolvedActions.filter((action) => !action.destructive);
  const destructive = resolvedActions.filter((action) => action.destructive);

  return (
    <span className="BulkActionsInline" data-bulk-bar="true">
      <ButtonGroup>
        {lifecycle.map(renderAction)}
        {lifecycle.length > 0 && destructive.length > 0 ? <Divider /> : null}
        {destructive.map(renderAction)}
      </ButtonGroup>
    </span>
  );
}

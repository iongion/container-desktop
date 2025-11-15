import {
  Alignment,
  Button,
  ButtonGroup,
  Classes,
  Divider,
  type InputGroupProps,
  Intent,
  MenuItem,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ItemRenderer, Select } from "@blueprintjs/select";
import classNames from "classnames";
import type React from "react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  type ControllerScope,
  ControllerScopeType,
  type LIMAInstance,
  type PodmanMachine,
  type SSHHost,
  type WSLDistribution,
} from "@/env/Types";
import i18n from "@/web-app/App.i18n";

import "./ScopeSelect.css";

function isScopeStarted(scope?: ControllerScope): boolean {
  if (!scope) {
    return false;
  }
  switch (scope.Type) {
    case ControllerScopeType.PodmanMachine:
      return (scope as PodmanMachine).Running;
    case ControllerScopeType.WSLDistribution:
      return (scope as WSLDistribution).State === "Running";
    case ControllerScopeType.LIMAInstance:
      return (scope as LIMAInstance).Status === "Running";
    case ControllerScopeType.SSHConnection:
      return !!(scope as SSHHost).Usable;
    default:
      return false;
  }
}

const ScopeLabel: React.FC<{ scope: ControllerScope }> = ({ scope }) => {
  const { label, intent } = useMemo(() => {
    let label = "";
    let intent: Intent = Intent.NONE;
    switch (scope.Type) {
      case ControllerScopeType.PodmanMachine:
        label = (scope as PodmanMachine).Running ? i18n.t("Running") : i18n.t("Stopped");
        intent = (scope as PodmanMachine).Running ? Intent.SUCCESS : Intent.DANGER;
        break;
      case ControllerScopeType.WSLDistribution:
        label = (scope as WSLDistribution).State;
        intent = (scope as WSLDistribution).State === "Running" ? Intent.SUCCESS : Intent.DANGER;
        break;
      case ControllerScopeType.LIMAInstance:
        label = (scope as LIMAInstance).Status;
        intent = (scope as LIMAInstance).Status === "Running" ? Intent.SUCCESS : Intent.DANGER;
        break;
      case ControllerScopeType.SSHConnection:
        label = (scope as SSHHost).Connected ? i18n.t("Connected") : i18n.t("Disconnected");
        intent = (scope as SSHHost).Connected ? Intent.SUCCESS : Intent.DANGER;
        break;
      default:
        break;
    }
    return {
      label,
      intent,
    };
  }, [scope]);
  return (
    <div className="ScopeLabel" data-intent={intent}>
      {label}
    </div>
  );
};

const renderControllerScope: ItemRenderer<ControllerScope> = (item, { handleClick, handleFocus, modifiers, query }) => {
  if (!modifiers.matchesPredicate) {
    return null;
  }
  return (
    <MenuItem
      className="ScopeSelectMenuItem"
      active={modifiers.active}
      disabled={modifiers.disabled}
      key={item.Name}
      labelElement={<ScopeLabel scope={item} />}
      onClick={handleClick}
      onFocus={handleFocus}
      roleStructure="listoption"
      text={item.Name}
    />
  );
};

export interface ScopeSelectProps {
  items: ControllerScope[];
  inputProps: Partial<Omit<InputGroupProps, "value" | "onChange">>;
  scope?: string;
  disabled?: boolean;
  pending?: boolean;
  withoutDetect?: boolean;
  detectLabel?: React.ReactNode;
  onChange?: (item: ControllerScope, event?: React.SyntheticEvent<HTMLElement, Event>) => void;
  onDetect?: (event?: React.MouseEvent<HTMLElement, MouseEvent>) => void;
  onStart?: (item: ControllerScope) => void;
  onStop?: (item: ControllerScope) => void;
}

export const ScopeSelect: React.FC<ScopeSelectProps> = ({
  items,
  inputProps,
  disabled,
  pending,
  withoutDetect,
  scope,
  detectLabel = i18n.t("Detect"),
  onChange,
  onDetect,
  onStart,
  onStop,
}: ScopeSelectProps) => {
  const { t } = useTranslation();
  const activeItem = scope ? items.find((it) => it.Name === scope) : undefined;
  const canControlScope = !!activeItem;
  const labels = useMemo(() => {
    const values = {
      scopeStop: t("Stop"),
      scopeStart: t("Start"),
    };
    if (activeItem?.Type === ControllerScopeType.SSHConnection) {
      values.scopeStart = t("Connect");
      values.scopeStop = t("Disconnect");
    }
    return values;
  }, [t, activeItem]);
  const onItemSelect = useCallback(
    (scope: ControllerScope, event?: React.SyntheticEvent<HTMLElement, Event>) => {
      onChange?.(scope, event);
    },
    [onChange],
  );
  const onScopeStartStop = useCallback(() => {
    if (!activeItem) {
      return;
    }
    if (isScopeStarted(activeItem)) {
      onStop?.(activeItem);
    } else {
      onStart?.(activeItem);
    }
  }, [activeItem, onStart, onStop]);
  return (
    <div className="ConnectionEntitySelect ScopeSelect">
      <Select<ControllerScope>
        filterable={false}
        fill
        resetOnSelect
        scrollToActiveItem
        inputProps={inputProps}
        items={items}
        itemRenderer={renderControllerScope}
        onItemSelect={onItemSelect}
        popoverProps={{ matchTargetWidth: true, minimal: true }}
        activeItem={activeItem}
      >
        <Button
          className="ScopeSelectButton"
          alignText={Alignment.LEFT}
          disabled={disabled}
          fill
          icon={IconNames.CONTROL}
          rightIcon={IconNames.CARET_DOWN}
          text={
            <>
              <div className="ScopeSelectButtonText">{activeItem?.Name ?? t("-- Select --")}</div>
              {activeItem ? <ScopeLabel scope={activeItem} /> : null}
            </>
          }
          textClassName={classNames({
            [Classes.TEXT_MUTED]: activeItem === undefined,
          })}
        />
      </Select>
      {withoutDetect ? null : (
        <ButtonGroup minimal>
          <Divider />
          <Button
            icon={isScopeStarted(activeItem) ? IconNames.STOP : IconNames.PLAY}
            disabled={disabled || pending || !canControlScope}
            text={isScopeStarted(activeItem) ? labels.scopeStop : labels.scopeStart}
            onClick={onScopeStartStop}
          />
          <Divider />
          <Button
            icon={IconNames.REFRESH}
            disabled={disabled || pending}
            small
            text={detectLabel}
            intent={Intent.SUCCESS}
            onClick={onDetect}
          />
        </ButtonGroup>
      )}
    </div>
  );
};

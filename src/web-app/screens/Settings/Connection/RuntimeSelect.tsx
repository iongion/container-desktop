/* eslint-disable jsx-a11y/no-autofocus */
import { Alignment, Button, ButtonGroup, Classes, Divider, InputGroupProps, Intent, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { ItemRenderer, Select } from "@blueprintjs/select";
import classNames from "classnames";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ContainerRuntime, ContainerRuntimeOption } from "@/env/Types";

import "./RuntimeSelect.css";

// RuntimeSelect

const renderContainerRuntimeOption: ItemRenderer<ContainerRuntimeOption> = (item, { handleClick, handleFocus, modifiers, query }) => {
  if (!modifiers.matchesPredicate) {
    return null;
  }
  return (
    <MenuItem
      className="RuntimeSelectMenuItem"
      active={modifiers.active}
      disabled={modifiers.disabled}
      key={item.runtime}
      onClick={handleClick}
      onFocus={handleFocus}
      roleStructure="listoption"
      text={item.label}
    />
  );
};

export interface RuntimeSelectProps {
  items: ContainerRuntimeOption[];
  inputProps: Partial<Omit<InputGroupProps, "value" | "onChange">>;
  runtime?: ContainerRuntime;
  disabled?: boolean;
  pending?: boolean;
  withoutDetect?: boolean;
  onChange?: (item: ContainerRuntime, event?: React.SyntheticEvent<HTMLElement>) => void;
  onDetect?: (item: ContainerRuntime, event?: React.MouseEvent<HTMLElement, MouseEvent>) => void;
}

export const RuntimeSelect: React.FC<RuntimeSelectProps> = ({ items, inputProps, disabled, pending, withoutDetect, runtime, onChange, onDetect }: RuntimeSelectProps) => {
  const { t } = useTranslation();
  const activeItem = runtime ? items.find((it) => it.runtime === runtime) : undefined;
  const onItemSelect = useCallback(
    (e: any) => {
      onChange?.(e.runtime);
    },
    [onChange]
  );
  const onItemDetect = useCallback(
    (e: any) => {
      if (activeItem) {
        onDetect?.(activeItem.runtime, e);
      }
    },
    [onDetect, activeItem]
  );
  return (
    <div className="ConnectionEntitySelect RuntimeSelect">
      <Select<ContainerRuntimeOption>
        filterable={false}
        fill
        resetOnSelect
        scrollToActiveItem
        inputProps={inputProps}
        items={items}
        itemRenderer={renderContainerRuntimeOption}
        onItemSelect={onItemSelect}
        popoverProps={{ matchTargetWidth: true, minimal: true }}
        activeItem={activeItem}
      >
        <Button
          alignText={Alignment.LEFT}
          disabled={disabled}
          fill
          rightIcon={IconNames.CARET_DOWN}
          text={activeItem?.label ?? t("-- Select --")}
          textClassName={classNames({
            [Classes.TEXT_MUTED]: activeItem === undefined
          })}
        />
      </Select>
      {withoutDetect ? null : (
        <>
          <Divider />
          <ButtonGroup minimal>
            <Button disabled={pending} small text={t("Detect")} intent={Intent.SUCCESS} onClick={onItemDetect} />
          </ButtonGroup>
        </>
      )}
    </div>
  );
};

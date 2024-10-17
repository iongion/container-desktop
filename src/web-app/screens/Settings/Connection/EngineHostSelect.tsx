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
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, ContainerEngineHost } from "@/env/Types";

import { RestrictedTo } from "@/web-app/components/RestrictedTo";
import "./EngineHostSelect.css";

// EngineHostSelect

const renderMenuItem: ItemRenderer<Connector> = (item, { handleClick, handleFocus, modifiers, query }) => {
  if (!modifiers.matchesPredicate) {
    return null;
  }
  const isDisabled = modifiers.disabled || item.disabled || !item.availability.enabled;
  return (
    <MenuItem
      className="EngineHostSelectMenuItem"
      active={modifiers.active}
      disabled={isDisabled}
      key={item.host}
      labelElement={(<RestrictedTo host={item.host} />) as any}
      onClick={handleClick}
      onFocus={handleFocus}
      roleStructure="listoption"
      text={item.label}
      title={isDisabled ? item.notes : ""}
    />
  );
};

export interface EngineSelectProps {
  items: Connector[];
  inputProps: Partial<Omit<InputGroupProps, "value" | "onChange">>;
  host?: ContainerEngineHost;
  disabled?: boolean;
  pending?: boolean;
  withoutDetect?: boolean;
  onChange?: (item: ContainerEngineHost, event?: React.SyntheticEvent<HTMLElement>) => void;
  onDetect?: (item: ContainerEngineHost, event?: React.MouseEvent<HTMLElement, MouseEvent>) => void;
}

export const EngineHostSelect: React.FC<EngineSelectProps> = ({
  items,
  inputProps,
  disabled,
  pending,
  withoutDetect,
  host,
  onChange,
  onDetect,
}: EngineSelectProps) => {
  const { t } = useTranslation();
  const activeItem = host ? items.find((it) => it.host === host) : undefined;
  const onItemSelect = useCallback(
    (e: any) => {
      onChange?.(e.host);
    },
    [onChange],
  );
  const onItemDetect = useCallback(
    (e: any) => {
      if (activeItem) {
        onDetect?.(activeItem.host, e);
      }
    },
    [onDetect, activeItem],
  );
  return (
    <div className="ConnectionEntitySelect EngineHostSelect">
      <Select<Connector>
        filterable={false}
        fill
        resetOnSelect
        scrollToActiveItem
        inputProps={inputProps}
        items={items}
        itemRenderer={renderMenuItem}
        onItemSelect={onItemSelect}
        popoverProps={{ matchTargetWidth: true, minimal: true }}
        activeItem={activeItem}
      >
        <Button
          alignText={Alignment.LEFT}
          disabled={disabled}
          fill
          rightIcon={IconNames.CARET_DOWN}
          title={activeItem?.description}
          text={activeItem?.label ?? t("-- Select --")}
          textClassName={classNames({
            [Classes.TEXT_MUTED]: activeItem === undefined,
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

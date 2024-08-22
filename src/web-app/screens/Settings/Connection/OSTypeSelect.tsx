/* eslint-disable jsx-a11y/no-autofocus */
import { Button, ButtonGroup, Divider, HTMLSelect, HTMLSelectProps, Intent } from "@blueprintjs/core";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { OperatingSystem } from "@/platform";
import "./OSTypeSelect.css";

// OSTypeSelect

export interface OSTypeSelectProps {
  inputProps: Partial<Omit<HTMLSelectProps, "fill" | "value" | "onChange">>;
  osType?: OperatingSystem;
  disabled?: boolean;
  pending?: boolean;
  withoutDetect?: boolean;
  onChange?: (item: OperatingSystem, event?: React.ChangeEvent<HTMLSelectElement>) => void;
  onDetect?: (item: OperatingSystem, event?: React.MouseEvent<HTMLElement, MouseEvent>) => void;
}

export const OSTypeSelect: React.FC<OSTypeSelectProps> = ({ inputProps, disabled, pending, withoutDetect, osType, onChange, onDetect }: OSTypeSelectProps) => {
  const { t } = useTranslation();
  const onItemSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e.target.value as OperatingSystem, e);
    },
    [onChange]
  );
  const onItemDetect = useCallback(
    (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      if (osType) {
        onDetect?.(osType, e);
      }
    },
    [onDetect, osType]
  );
  return (
    <div className="ConnectionEntitySelect OSTypeSelect">
      <HTMLSelect {...inputProps} disabled={pending || disabled} fill value={osType} onChange={onItemSelect}>
        <option value={OperatingSystem.Browser}>Browser</option>
        <option value={OperatingSystem.Mac}>MacOS</option>
        <option value={OperatingSystem.Linux}>Linux</option>
        <option value={OperatingSystem.Unknown}>Unknown</option>
        <option value={OperatingSystem.Windows}>Windows</option>
      </HTMLSelect>
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

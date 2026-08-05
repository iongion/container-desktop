// The reference half of "Workspace tools": which container the tools enter, or which image a disposable one is
// created from. Both are read from the connection the session runs on, so the form offers what that engine
// actually has — and still ACCEPTS a name the list does not carry, because a container can be started, or an
// image pulled, between filling this in and starting the session.
//
// A Suggest rather than an HTMLSelect for exactly that reason: a select cannot express "one of these, or
// something else". Mirrors ConnectionSelect's Blueprint-Select idiom — same popover props, same fill, same
// MenuItem rows.

import { MenuItem, Spinner, SpinnerSize } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ItemRenderer, Suggest } from "@blueprintjs/select";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useContainers } from "@/web-app/screens/Container/queries";
import { useImages } from "@/web-app/screens/Image/queries";

import {
  type ExecutionTargetOption,
  executionTargetMatches,
  pulledImageOptions,
  runningContainerOptions,
} from "./executionTargets";

import "./ExecutionTargetSelect.css";

export interface ExecutionTargetSelectProps {
  // Which reference is being named. The two kinds that need one are the only ones this renders for.
  kind: "container" | "sandbox";
  connectionId: string;
  value: string;
  onChange: (reference: string) => void;
  disabled?: boolean;
}

const renderOption: ItemRenderer<ExecutionTargetOption> = (option, { handleClick, handleFocus, modifiers }) => {
  if (!modifiers.matchesPredicate) return null;
  return (
    <MenuItem
      className="ExecutionTargetMenuItem"
      active={modifiers.active}
      disabled={modifiers.disabled}
      key={option.reference}
      onClick={handleClick}
      onFocus={handleFocus}
      text={
        <span className="ExecutionTargetOption">
          <span className="ExecutionTargetOptionName">{option.label}</span>
          <span className="ExecutionTargetOptionMeta">{option.meta}</span>
        </span>
      }
    />
  );
};

export const ExecutionTargetSelect: React.FC<ExecutionTargetSelectProps> = ({
  kind,
  connectionId,
  value,
  onChange,
  disabled,
}: ExecutionTargetSelectProps) => {
  const { t } = useTranslation();
  const containers = useContainers(connectionId, kind === "container");
  const images = useImages(connectionId, kind === "sandbox");
  const source = kind === "container" ? containers : images;
  const options = useMemo(
    () =>
      kind === "container" ? runningContainerOptions(containers.data ?? []) : pulledImageOptions(images.data ?? []),
    [kind, containers.data, images.data],
  );

  // What the engine did not answer with is not silence: the field stays usable and says why the list is empty.
  const emptyText =
    source.isPending && connectionId
      ? kind === "container"
        ? t("Reading this connection's containers…")
        : t("Reading this connection's images…")
      : source.isError
        ? kind === "container"
          ? t("This connection did not answer with its containers. Type a name.")
          : t("This connection did not answer with its images. Type a reference.")
        : kind === "container"
          ? t("No container is running on this connection. Type a name.")
          : t("No image is pulled on this connection. Type a reference.");

  return (
    <Suggest<ExecutionTargetOption>
      fill
      resetOnClose
      className="ExecutionTargetSelect"
      disabled={disabled}
      items={options}
      itemRenderer={renderOption}
      itemPredicate={(query, option) => executionTargetMatches(option, query)}
      inputValueRenderer={(option) => option.reference}
      // A reference the list does not carry is still a selection. Synthesizing it keeps the field showing what was
      // named — a controlled `selectedItem` limited to `options` would blank the input the moment the popover
      // closed, and the form would look empty while holding a perfectly good name.
      selectedItem={
        options.find((option) => option.reference === value) ??
        (value ? { reference: value, label: value, meta: "" } : null)
      }
      onItemSelect={(option) => onChange(option.reference)}
      createNewItemFromQuery={(query) => ({ reference: query.trim(), label: query.trim(), meta: "" })}
      createNewItemRenderer={(query, active, handleClick) => (
        <MenuItem
          active={active}
          icon={IconNames.ADD}
          key="create"
          onClick={handleClick}
          text={t('Use "{{reference}}"', { reference: query.trim() })}
        />
      )}
      noResults={
        <MenuItem
          disabled
          className="ExecutionTargetEmpty"
          text={emptyText}
          {...(source.isPending && connectionId ? { icon: <Spinner size={SpinnerSize.SMALL} /> } : {})}
        />
      }
      popoverProps={{ matchTargetWidth: true, minimal: true }}
      inputProps={{
        id: "agentExecutionRef",
        leftIcon: kind === "container" ? IconNames.BOX : IconNames.CUBE,
        placeholder:
          kind === "container"
            ? t("Pick a running container, or type a name or id")
            : t("Pick an image, or type a reference"),
      }}
    />
  );
};

// components/ConnectionSelect.tsx — the ONE connection picker for every connection-dependent form.
//
// In the always-merged workspace an action (create a container/volume/network/secret/pod/machine/registry,
// or pull an image) has to target exactly ONE connected engine. This is the single control that chooses it,
// rendered as the FIRST element of each such form. It lists ONLY connected (running) connections, defaults to
// the primary, and marks each with the shared EngineCell so the engine is unmistakable. It mirrors the
// Blueprint Select pattern used by Settings' EngineSelect, but selects a live Connection — not an engine type.

import { Alignment, Button, Classes, FormGroup, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ItemRenderer, Select } from "@blueprintjs/select";
import classNames from "classnames";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "@/env/Types";
import { EngineCell } from "@/web-app/components/EngineCell";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

import { connectedConnections, pickActiveConnection } from "./ConnectionSelect.logic";

import "./ConnectionSelect.css";

export {
  connectedConnections,
  isComposeConnection,
  isDockerConnection,
  isPodmanConnection,
} from "./ConnectionSelect.logic";

const renderConnection: ItemRenderer<Connection> = (item, { handleClick, handleFocus, modifiers }) => {
  if (!modifiers.matchesPredicate) {
    return null;
  }
  return (
    <MenuItem
      className="ConnectionSelectMenuItem"
      active={modifiers.active}
      disabled={modifiers.disabled}
      key={item.id}
      onClick={handleClick}
      onFocus={handleFocus}
      text={
        <span className="ConnectionSelectOption">
          <EngineCell engine={item.engine} connectionName={item.name} />
          <span className="ConnectionSelectOptionName">{item.name}</span>
        </span>
      }
    />
  );
};

export interface ConnectionSelectProps {
  value: string;
  onChange: (connectionId: string) => void;
  // Narrow the eligible set, e.g. `isPodmanConnection` for Podman-only domains (pods/secrets/machines).
  filter?: (connection: Connection) => boolean;
  disabled?: boolean;
  label?: string;
  // Render the label beside the Select instead of stacked above it.
  inline?: boolean;
}

export const ConnectionSelect: React.FC<ConnectionSelectProps> = ({
  value,
  onChange,
  filter,
  disabled,
  label,
  inline,
}: ConnectionSelectProps) => {
  const { t } = useTranslation();
  const connections = useAppStore((state) => state.connections);
  const defaultId = useAppStore((state) => state.userSettings?.connector?.default);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const items = connectedConnections(connections, activeRuntime, filter);
  const active = pickActiveConnection(items, value, defaultId);
  // Keep the parent's value in sync with what is shown (and with what the mutation will target): when the
  // value is empty or no longer eligible, adopt the resolved default. Converges in one render (active is a
  // stable reference from the store, so this does not loop).
  useEffect(() => {
    if (active && active.id !== value) {
      onChange(active.id);
    }
  }, [active, value, onChange]);
  // A single eligible connection (or an explicitly disabled form) still shows the engine, but cannot be changed.
  const locked = disabled || items.length <= 1;
  return (
    <FormGroup className="ConnectionSelect" label={label ?? t("Connection")} inline={inline}>
      <Select<Connection>
        fill={!inline}
        filterable={items.length > 6}
        resetOnSelect
        scrollToActiveItem
        items={items}
        itemRenderer={renderConnection}
        itemPredicate={(query, item) => `${item.name} ${item.engine}`.toLowerCase().includes(query.toLowerCase())}
        onItemSelect={(item) => onChange(item.id)}
        popoverProps={{ matchTargetWidth: true, minimal: true }}
        activeItem={active}
        disabled={locked}
      >
        <Button
          alignText={Alignment.START}
          className="ConnectionSelectButton"
          disabled={locked}
          fill={!inline}
          endIcon={IconNames.CARET_DOWN}
          text={
            active ? (
              <span className="ConnectionSelectOption">
                <EngineCell engine={active.engine} connectionName={active.name} />
                <span className="ConnectionSelectOptionName">{active.name}</span>
              </span>
            ) : (
              t("No connected engine")
            )
          }
          textClassName={classNames({ [Classes.TEXT_MUTED]: !active })}
        />
      </Select>
    </FormGroup>
  );
};

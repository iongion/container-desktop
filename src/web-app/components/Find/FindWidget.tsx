import { Button, InputGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";

export interface FindWidgetProps {
  query: string;
  onQueryChange: (value: string) => void;
  caseSensitive: boolean;
  onToggleCase: () => void;
  index: number;
  count: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  onKeyUp: React.KeyboardEventHandler<HTMLElement>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  style?: React.CSSProperties;
}

export const FindWidget: React.FC<FindWidgetProps> = ({
  query,
  onQueryChange,
  caseSensitive,
  onToggleCase,
  index,
  count,
  onNext,
  onPrevious,
  onClose,
  onKeyDown,
  onKeyUp,
  inputRef,
  style,
}: FindWidgetProps) => {
  const hasQuery = query.length > 0;
  const noMatches = hasQuery && count === 0;
  return (
    <search
      className="ContainerFindWidget"
      data-no-matches={noMatches ? "yes" : "no"}
      style={style}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <InputGroup
        className="ContainerFindWidgetInput"
        inputRef={inputRef}
        value={query}
        leftIcon={IconNames.SEARCH}
        placeholder="Find"
        aria-label="Find in view"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <span className="ContainerFindWidgetCount" aria-live="polite">
        {hasQuery ? (count ? `${index}/${count}` : "No results") : ""}
      </span>
      <Button
        className="ContainerFindWidgetCase"
        size="small"
        variant="minimal"
        active={caseSensitive}
        title="Match case"
        aria-label="Match case"
        text="Aa"
        onClick={onToggleCase}
      />
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.CHEVRON_UP}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={!count}
        onClick={onPrevious}
      />
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.CHEVRON_DOWN}
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={!count}
        onClick={onNext}
      />
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.CROSS}
        title="Close (Esc)"
        aria-label="Close find"
        onClick={onClose}
      />
    </search>
  );
};

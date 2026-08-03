// A generic column-of-cards board, generalised from the Run screen's task-wave layout so the Runs list and the
// run's task graph share one look. Presentation only: columns and cards are supplied by the caller, which keeps
// the grouping rule (a pure function) testable without rendering anything. Each column windows its own card list
// (one virtualizer per column, same @tanstack/react-virtual engine the resource tables use) so a lane with
// hundreds of cards only ever mounts the visible slice.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import "./Board.css";

const CARD_ESTIMATE_HEIGHT = 96;
const CARD_OVERSCAN = 8;

export interface BoardColumn<T> {
  key: string;
  label: string;
  items: T[];
}

export interface BoardProps<T> {
  columns: BoardColumn<T>[];
  renderCard: (item: T) => React.ReactNode;
  getCardKey: (item: T) => string;
  className?: string;
}

function BoardColumnView<T>({
  column,
  renderCard,
  getCardKey,
}: {
  column: BoardColumn<T>;
  renderCard: (item: T) => React.ReactNode;
  getCardKey: (item: T) => string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: column.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE_HEIGHT,
    getItemKey: (index) => getCardKey(column.items[index]),
    overscan: CARD_OVERSCAN,
  });
  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div className="BoardColumn" data-column={column.key}>
      <div className="BoardColumnHead">
        <span className="BoardColumnLabel">{column.label}</span>
        <span className="BoardColumnCount">{column.items.length}</span>
      </div>
      <div className="BoardColumnBody" ref={scrollRef}>
        <div className="BoardColumnCanvas" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => (
            <div
              className="BoardCardSlot"
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {renderCard(column.items[virtualItem.index])}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Board<T>({ columns, renderCard, getCardKey, className }: BoardProps<T>) {
  return (
    <div className={`Board ${className ?? ""}`.trim()}>
      {columns.map((column) => (
        <BoardColumnView key={column.key} column={column} renderCard={renderCard} getCardKey={getCardKey} />
      ))}
    </div>
  );
}

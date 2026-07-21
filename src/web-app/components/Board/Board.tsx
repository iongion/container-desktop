// A generic column-of-cards board, generalised from the Goal screen's task-wave layout so the Goals list and the
// run's task graph share one look. Presentation only: columns and cards are supplied by the caller, which keeps
// the grouping rule (a pure function) testable without rendering anything.

import "./Board.css";

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

export function Board<T>({ columns, renderCard, getCardKey, className }: BoardProps<T>) {
  return (
    <div className={`Board ${className ?? ""}`.trim()}>
      {columns.map((column) => (
        <div className="BoardColumn" key={column.key} data-column={column.key}>
          <div className="BoardColumnHead">
            <span className="BoardColumnLabel">{column.label}</span>
            <span className="BoardColumnCount">{column.items.length}</span>
          </div>
          <div className="BoardColumnBody">
            {column.items.map((item) => (
              <div className="BoardCardSlot" key={getCardKey(item)}>
                {renderCard(item)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

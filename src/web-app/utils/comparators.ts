import type { SortSpec } from "@/web-app/stores/sortStore";

export type SortValue = string | number | boolean | Date | null | undefined;
export type SortSelectors<T> = Record<string, (item: T) => SortValue>;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function toComparable(value: SortValue): string | number {
  if (value === null || typeof value === "undefined") {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "";
  }
  return value;
}

export function compareSortValues(a: SortValue, b: SortValue): number {
  const left = toComparable(a);
  const right = toComparable(b);
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return collator.compare(`${left}`, `${right}`);
}

export function sortByField<T>(items: T[], spec: SortSpec | undefined, selectors: SortSelectors<T>): T[] {
  if (!spec) {
    return items;
  }
  const selector = selectors[spec.field];
  if (!selector) {
    return items;
  }
  const direction = spec.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => direction * compareSortValues(selector(a), selector(b)));
}

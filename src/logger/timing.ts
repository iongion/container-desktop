// Pure, shell-agnostic startup/elapsed timeline. Clock injected so it is hermetically testable; in
// production the default monotonic clock is process-start-relative in main and navigationStart-relative
// in the renderer. No Electron deps — imported by both processes behind one singleton each.

export interface TimelineMark {
  name: string;
  at: number; // ms since t0
}

export interface Timeline {
  mark(name: string): void;
  since(name?: string): number;
  marks(): ReadonlyArray<TimelineMark>;
  summary(): string;
}

function defaultNow(): number {
  const perf = (globalThis as any).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

export function createTimeline(options: { now?: () => number; label?: string } = {}): Timeline {
  const now = options.now ?? defaultNow;
  const label = options.label ?? "timeline";
  const t0 = now();
  const recorded: TimelineMark[] = [];
  const round = (n: number) => Math.round(n);

  return {
    mark(name: string): void {
      recorded.push({ name, at: round(now() - t0) });
    },
    since(name?: string): number {
      const base = name ? (recorded.find((m) => m.name === name)?.at ?? 0) : 0;
      return round(now() - t0 - base);
    },
    marks(): ReadonlyArray<TimelineMark> {
      return recorded.slice();
    },
    summary(): string {
      const lines: string[] = [`${label} timeline:`];
      let prev = 0;
      for (const m of recorded) {
        lines.push(`  +${m.at - prev}ms  ${m.name}  (@${m.at}ms)`);
        prev = m.at;
      }
      const total = recorded.length ? recorded[recorded.length - 1].at : 0;
      lines.push(`  total: ${total}ms`);
      return lines.join("\n");
    },
  };
}

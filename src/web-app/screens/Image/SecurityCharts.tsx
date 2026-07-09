import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// Mend-style distribution donuts for the Security tab (severity + license breakdowns). Kept presentational —
// callers pass pre-summed, pre-colored slices. The breakdown reads from the multi-column legend beside the
// donut (not per-slice leader labels), so a busy license set never overlaps content.

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  slices: DonutSlice[];
  centerValue: number | string;
  centerLabel: string;
  size?: number;
  // When there are no non-zero slices, draw a faint full "all-clear" ring instead of an empty hole, so the
  // donut still reads as a chart. The ring is colored via the .SecurityDonutTrack CSS class (theme token) — its
  // geometry (r=40, strokeWidth=18 in a 100×100 viewBox) matches recharts' innerRadius 62% / outerRadius 98%.
  showEmptyTrack?: boolean;
}

// A compact donut with a centered total. Zero-value slices are dropped so empty severities don't render a sliver.
export const Donut: React.FC<DonutProps> = ({ slices, centerValue, centerLabel, size = 172, showEmptyTrack }) => {
  const data = slices.filter((slice) => slice.value > 0).map((slice) => ({ ...slice, fill: slice.color }));
  return (
    <div className="SecurityDonut" style={{ width: size, height: size }}>
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="98%"
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [String(value), String(name)]}
              contentStyle={{
                background: "var(--app-surface-strong)",
                border: "1px solid var(--app-border)",
                borderRadius: 6,
                color: "var(--app-text)",
                fontSize: 12,
                padding: "4px 8px",
              }}
              itemStyle={{ color: "var(--app-text)" }}
            />
          </PieChart>
        </ResponsiveContainer>
      ) : showEmptyTrack ? (
        <svg className="SecurityDonutTrack" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="40" fill="none" strokeWidth="18" />
        </svg>
      ) : null}
      <div className="SecurityDonutCenter">
        <span className="SecurityDonutValue">{centerValue}</span>
        <span className="SecurityDonutLabel">{centerLabel}</span>
      </div>
    </div>
  );
};

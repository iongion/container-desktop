import { Button, NonIdealState, Tree, type TreeNodeInfo } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RunSpanView } from "@/ai-system/core/runEvents";
import { formatDurationMs } from "@/web-app/utils/format";
import { buildWaterfall, limitWaterfall, type WaterfallAttempt, type WaterfallRow } from "./waterfallLayout";

import "./WaterfallView.css";

interface WaterfallViewProps {
  spans: RunSpanView[];
  droppedSpanRecords?: number;
  onSelectTask: (taskId: string) => void;
  viewSwitch: React.ReactNode;
}

interface WaterfallNodeData {
  type: "attempt" | "span";
  spanKey?: string;
  taskId?: string;
}

const WATERFALL_PAGE_SIZE = 500;

function Bar({ row }: { row: WaterfallRow }) {
  const { t } = useTranslation();
  if (!row.timingKnown)
    return (
      <span className="RunWaterfallUnknown" title={t("Unknown timing")}>
        —
      </span>
    );
  return (
    <span className="RunWaterfallBarTrack">
      <span
        className="RunWaterfallBar"
        data-status={row.span.status}
        data-incomplete={row.span.incomplete ? "yes" : "no"}
        style={{
          left: `${row.offsetPercent ?? 0}%`,
          width: row.widthPercent !== undefined ? `${row.widthPercent}%` : undefined,
        }}
      />
    </span>
  );
}

function SpanLabel({ row }: { row: WaterfallRow }) {
  const { t } = useTranslation();
  return (
    <span className="RunWaterfallLabel" title={row.span.name}>
      <span className="RunWaterfallName">{row.span.name}</span>
      <span className="RunWaterfallMeta">
        <span className="RunWaterfallKindLabel">{t(row.span.kind)}</span>
        <span className="RunWaterfallDuration">{formatDurationMs(row.span.durationMs)}</span>
      </span>
    </span>
  );
}

function spanNodes(
  attempt: WaterfallAttempt,
  collapsed: ReadonlySet<string>,
  selectedSpanKey: string | undefined,
): Array<TreeNodeInfo<WaterfallNodeData>> {
  const roots: Array<TreeNodeInfo<WaterfallNodeData>> = [];
  const parents: Array<TreeNodeInfo<WaterfallNodeData>> = [];
  for (const row of attempt.rows) {
    const id = `span:${row.key}`;
    const node: TreeNodeInfo<WaterfallNodeData> = {
      id,
      className: "RunWaterfallNode",
      label: <SpanLabel row={row} />,
      icon: <span className="RunWaterfallKind" data-kind={row.span.kind} data-status={row.span.status} />,
      secondaryLabel: <Bar row={row} />,
      hasCaret: row.hasChildren,
      isExpanded: row.hasChildren && !collapsed.has(id),
      isSelected: row.key === selectedSpanKey,
      nodeData: {
        type: "span",
        spanKey: row.key,
        ...(row.span.taskId ? { taskId: row.span.taskId } : {}),
      },
      ...(row.hasChildren ? { childNodes: [] } : {}),
    };
    if (row.depth === 0) roots.push(node);
    else parents[row.depth - 1]?.childNodes?.push(node);
    parents[row.depth] = node;
    parents.length = row.depth + 1;
  }
  return roots;
}

export function WaterfallView({ spans, droppedSpanRecords = 0, onSelectTask, viewSwitch }: WaterfallViewProps) {
  const { t } = useTranslation();
  const layout = useMemo(() => buildWaterfall(spans), [spans]);
  const [visibleLimit, setVisibleLimit] = useState(WATERFALL_PAGE_SIZE);
  const visible = useMemo(() => limitWaterfall(layout, visibleLimit), [layout, visibleLimit]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedSpanKey, setSelectedSpanKey] = useState<string>();
  const contents = useMemo<Array<TreeNodeInfo<WaterfallNodeData>>>(
    () =>
      visible.attempts.map((attempt) => {
        const id = `attempt:${attempt.attempt}`;
        return {
          id,
          className: "RunWaterfallAttempt",
          label: (
            <span className="RunWaterfallAttemptLabel">
              {t("Attempt {{attempt}}", { attempt: attempt.attempt })}
              <span className="RunWaterfallAttemptDuration">{formatDurationMs(attempt.durationMs)}</span>
            </span>
          ),
          icon: IconNames.HISTORY,
          hasCaret: attempt.rows.length > 0,
          isExpanded: !collapsed.has(id),
          childNodes: spanNodes(attempt, collapsed, selectedSpanKey),
          nodeData: { type: "attempt" },
        };
      }),
    [collapsed, selectedSpanKey, t, visible.attempts],
  );
  const setExpanded = (id: string | number, expanded: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (expanded) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  };

  return (
    <section className="RunPanel RunWaterfall">
      <div className="RunPanelHead">
        <span className="bp6-icon bp6-icon-timeline-bar-chart" />
        <span>{t("Waterfall")}</span>
        <div className="RunPanelHeadActions">
          <span className="RunPanelHeadSub">
            {droppedSpanRecords > 0
              ? t("{{count}} spans · {{dropped}} omitted", { count: spans.length, dropped: droppedSpanRecords })
              : t("{{count}} spans", { count: spans.length })}
          </span>
          {viewSwitch}
        </div>
      </div>
      {contents.length === 0 ? (
        <NonIdealState
          icon={IconNames.TIMELINE_BAR_CHART}
          title={t("No timing evidence")}
          description={t("Span timing appears here as the run progresses.")}
        />
      ) : (
        <div className="RunWaterfallBody">
          <div className="RunWaterfallCanvas">
            <div className="RunWaterfallAxis" aria-hidden="true">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
            <Tree<WaterfallNodeData>
              compact
              contents={contents}
              onNodeExpand={(node) => setExpanded(node.id, true)}
              onNodeCollapse={(node) => setExpanded(node.id, false)}
              onNodeClick={(node) => {
                if (node.nodeData?.spanKey) setSelectedSpanKey(node.nodeData.spanKey);
                if (node.nodeData?.taskId) onSelectTask(node.nodeData.taskId);
              }}
            />
            {visible.remainingCount > 0 ? (
              <div className="RunWaterfallLoadMore">
                <Button
                  variant="minimal"
                  icon={IconNames.MORE}
                  text={t("Load {{count}} more spans", {
                    count: Math.min(WATERFALL_PAGE_SIZE, visible.remainingCount),
                  })}
                  onClick={() => setVisibleLimit((current) => current + WATERFALL_PAGE_SIZE)}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

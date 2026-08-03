// The task DAG as a React Flow canvas. React Flow owns node coordinates internally, so edges are drawn from
// positions it already knows — there is no getBoundingClientRect race, which is what left the old hand-rolled SVG
// overlay blank until the first click. Nodes are the exact task cards (same markup + CSS) and edges are bezier
// curves matching the mockup; pan (drag) and zoom (wheel) come for free. All React Flow chrome (background grid,
// controls, minimap, attribution) is suppressed so the panel reads exactly like the previous columns.
import { Button, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import {
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { RunTaskView } from "@/ai-system/core/runEvents";
import { useAvatars } from "@/web-app/components/ai/avatarQueries";
import { WorkerAvatar } from "@/web-app/components/ai/WorkerAvatar";
import { useWorkers } from "@/web-app/screens/AI/Worker/queries";
import type { RunGraphEdge } from "./dagEdges";
import { GRAPH_COLUMN_WIDTH, runGraphLayout } from "./runGraphLayout";

import "@xyflow/react/dist/style.css";

interface TaskNodeData extends Record<string, unknown> {
  task: RunTaskView;
  selected: boolean;
}

interface WaveLabelData extends Record<string, unknown> {
  index: number;
}

type TaskFlowNode = Node<TaskNodeData, "task">;
type WaveFlowNode = Node<WaveLabelData, "waveLabel">;
type RunFlowNode = TaskFlowNode | WaveFlowNode;

// The task card — identical markup/classes to the former TaskNode, so every theme token and status style carries
// over untouched. Selection and click are driven by React Flow (onNodeClick), so this renders as a plain div; the
// two handles are the (invisible) attach points the dependency edges bow between.
const TaskFlowNodeView: React.FC<NodeProps<TaskFlowNode>> = ({ data }) => {
  const { t } = useTranslation();
  const { data: workers } = useWorkers();
  const { data: avatars } = useAvatars();
  const { task, selected } = data;
  const worker = task.workerId ? workers?.find((entry) => entry.id === task.workerId) : undefined;
  return (
    <div
      className="RunTask"
      data-status={task.status}
      data-selected={selected ? "yes" : "no"}
      data-model={task.model || undefined}
      title={task.description}
    >
      <Handle type="target" position={Position.Left} className="RunTaskHandle" isConnectable={false} />
      <span className="RunTaskAvatar">
        <WorkerAvatar avatarId={worker?.avatarId} name={task.agent} customs={avatars ?? []} size={28} />
      </span>
      <span className="RunTaskBody">
        <span className="RunTaskTitle">
          <span className="RunTaskDot" data-status={task.status} />
          <span className="RunTaskTitleText">{task.title}</span>
        </span>
        <span className="RunTaskMeta">
          <span className="RunTaskState" data-status={task.status}>
            {t(task.status)}
          </span>
          <span className="RunTaskAgent">{task.agent}</span>
        </span>
      </span>
      <Handle type="source" position={Position.Right} className="RunTaskHandle" isConnectable={false} />
    </div>
  );
};

const WaveLabelNodeView: React.FC<NodeProps<WaveFlowNode>> = ({ data }) => {
  const { t } = useTranslation();
  return (
    <div className="RunWaveLabel">
      {data.index === 0 ? t("Wave 1 — parallel") : t("Wave {{n}}", { n: data.index + 1 })}
    </div>
  );
};

const nodeTypes: NodeTypes = { task: TaskFlowNodeView, waveLabel: WaveLabelNodeView };

// Which task fields change what a card shows or where it sits. `task` gets a new identity on every streamed output
// delta, but the card renders none of that output — so a node is only rebuilt when one of these actually changes.
function taskNodeKey(task: RunTaskView, x: number, y: number, selected: boolean): string {
  return `${task.status}:${task.title}:${task.agent}:${task.workerId ?? ""}:${task.model ?? ""}:${x}:${y}:${selected}`;
}

// Build the React Flow nodes, reusing the previous render's object for any node whose key is unchanged. Honest deps
// (waves, focusedTaskId) keep the memo correct; the per-id cache keeps object identity stable across the output
// deltas that would otherwise re-render every card and defeat React Flow's own memoization.
function useRunFlowNodes(waves: readonly RunTaskView[][], focusedTaskId?: string): RunFlowNode[] {
  const cache = useRef(new Map<string, { key: string; node: RunFlowNode }>());
  return useMemo(() => {
    const layout = runGraphLayout(waves.map((wave) => wave.map((task) => task.id)));
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));
    const next: RunFlowNode[] = [];
    const live = new Set<string>();
    for (const anchor of layout.waves) {
      const id = `wave-${anchor.index}`;
      live.add(id);
      const key = `wave:${anchor.index}:${anchor.x}`;
      const hit = cache.current.get(id);
      if (hit && hit.key === key) {
        next.push(hit.node);
        continue;
      }
      const node: RunFlowNode = {
        id,
        type: "waveLabel",
        position: { x: anchor.x, y: anchor.y },
        data: { index: anchor.index },
        draggable: false,
        selectable: false,
        focusable: false,
        width: GRAPH_COLUMN_WIDTH,
      };
      cache.current.set(id, { key, node });
      next.push(node);
    }
    for (const wave of waves) {
      for (const task of wave) {
        const point = positions.get(task.id);
        if (!point) continue;
        live.add(task.id);
        const key = taskNodeKey(task, point.x, point.y, task.id === focusedTaskId);
        const hit = cache.current.get(task.id);
        if (hit && hit.key === key) {
          next.push(hit.node);
          continue;
        }
        const node: RunFlowNode = {
          id: task.id,
          type: "task",
          position: { x: point.x, y: point.y },
          data: { task, selected: task.id === focusedTaskId },
          draggable: false,
          width: GRAPH_COLUMN_WIDTH,
        };
        cache.current.set(task.id, { key, node });
        next.push(node);
      }
    }
    for (const id of cache.current.keys()) {
      if (!live.has(id)) cache.current.delete(id);
    }
    return next;
  }, [waves, focusedTaskId]);
}

// Same stable-identity treatment for edges: an edge only changes when its focus (active) state flips.
function useRunFlowEdges(edges: readonly RunGraphEdge[], focusedTaskId?: string): Edge[] {
  const cache = useRef(new Map<string, { key: string; edge: Edge }>());
  return useMemo(() => {
    const next: Edge[] = [];
    const live = new Set<string>();
    for (const edge of edges) {
      const id = `${edge.from}->${edge.to}`;
      live.add(id);
      const active = edge.from === focusedTaskId || edge.to === focusedTaskId;
      const key = String(active);
      const hit = cache.current.get(id);
      if (hit && hit.key === key) {
        next.push(hit.edge);
        continue;
      }
      const built: Edge = {
        id,
        source: edge.from,
        target: edge.to,
        type: "default",
        className: active ? "is-active" : undefined,
      };
      cache.current.set(id, { key, edge: built });
      next.push(built);
    }
    for (const id of cache.current.keys()) {
      if (!live.has(id)) cache.current.delete(id);
    }
    return next;
  }, [edges, focusedTaskId]);
}

const FIT_VIEW_OPTIONS = { padding: 0.15 };

interface RunGraphProps {
  waves: readonly RunTaskView[][];
  edges: readonly RunGraphEdge[];
  focusedTaskId?: string;
  onSelect: (taskId: string) => void;
}

interface RunGraphPanelProps extends RunGraphProps {
  viewSwitch: React.ReactNode;
}

const RunGraphCanvas: React.FC<RunGraphProps> = ({ waves, edges, focusedTaskId, onSelect }) => {
  const nodes = useRunFlowNodes(waves, focusedTaskId);
  const flowEdges = useRunFlowEdges(edges, focusedTaskId);
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: RunFlowNode) => {
      if (node.type === "task") onSelect(node.id);
    },
    [onSelect],
  );

  return (
    <ReactFlow<RunFlowNode>
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.35}
      maxZoom={1.75}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      proOptions={{ hideAttribution: true }}
    />
  );
};

// Pan (drag) and zoom (wheel) can wander the viewport off the graph; these canvas-overlay controls give the way
// back. They sit outside React Flow's transformed viewport, so graph pan/zoom never moves or scales them.
const RunGraphControls: React.FC = () => {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <ButtonGroup className="RunGraphControls" variant="minimal" size="small">
      <Button icon={IconNames.ZOOM_OUT} title={t("Zoom out")} onClick={() => zoomOut()} />
      <Button icon={IconNames.ZOOM_IN} title={t("Zoom in")} onClick={() => zoomIn()} />
      <Button icon={IconNames.ZOOM_TO_FIT} title={t("Reset view")} onClick={() => fitView(FIT_VIEW_OPTIONS)} />
    </ButtonGroup>
  );
};

// The whole task-graph panel stays inside one ReactFlowProvider so the canvas overlay can drive its flow instance.
export const RunGraphPanel: React.FC<RunGraphPanelProps> = ({ viewSwitch, ...props }) => {
  const { t } = useTranslation();
  const taskCount = props.waves.reduce((total, wave) => total + wave.length, 0);
  return (
    <ReactFlowProvider>
      <section className="RunPanel RunGraph">
        <div className="RunPanelHead">
          <span className="bp6-icon bp6-icon-graph" />
          <span>{t("Task graph")}</span>
          <div className="RunPanelHeadActions">
            <span className="RunPanelHeadSub">{t("{{count}} tasks", { count: taskCount })}</span>
            {viewSwitch}
          </div>
        </div>
        <div className="RunGraphBody">
          <RunGraphCanvas {...props} />
          <RunGraphControls />
        </div>
      </section>
    </ReactFlowProvider>
  );
};

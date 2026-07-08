import { Tree, type TreeNodeInfo } from "@blueprintjs/core";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { buildJsonTree, type JsonTreeNodeModel, type JsonValueKind } from "./jsonTree";

import "./JsonTreeView.css";

// Reusable, schema-free viewer that renders ARBITRARY JSON as a native Blueprint <Tree>: caret-only
// (no node icons), all branches collapsed, drill-down on click. Controlled-tree state follows the
// official Blueprint tree example (clone + Tree.nodeFromPath on expand/collapse).

const KIND_CLASS: Record<JsonValueKind, string> = {
  object: "",
  array: "",
  string: "jstr",
  number: "jnum",
  boolean: "jbool",
  null: "jnull",
};

function renderLabel(model: JsonTreeNodeModel) {
  const key = <span className={model.isIndex ? "jidx" : "jkey"}>{model.key}</span>;
  if (model.children) {
    return (
      <span className="JsonTreeLabel">
        {key}
        <span className="jsum">{model.summary}</span>
      </span>
    );
  }
  return (
    <span className="JsonTreeLabel">
      {key}
      <span className="jsep">:</span>
      <span className={`jval ${KIND_CLASS[model.kind]}`.trim()}>{model.valueText}</span>
    </span>
  );
}

function toTreeNodes(models: JsonTreeNodeModel[]): TreeNodeInfo[] {
  return models.map((model) => {
    const hasChildren = !!(model.children && model.children.length > 0);
    return {
      id: model.id,
      label: renderLabel(model),
      // caret shows only for non-empty branches; leaves and empty objects get none.
      hasCaret: hasChildren,
      isExpanded: false,
      childNodes: hasChildren ? toTreeNodes(model.children as JsonTreeNodeModel[]) : undefined,
    } satisfies TreeNodeInfo;
  });
}

type NodePath = number[];
type TreeState = TreeNodeInfo[];
type TreeAction = { type: "RESET"; nodes: TreeState } | { type: "SET_EXPANDED"; path: NodePath; isExpanded: boolean };

function cloneNodes(nodes: TreeState): TreeState {
  return nodes.map((node) => ({
    ...node,
    childNodes: node.childNodes ? cloneNodes(node.childNodes) : node.childNodes,
  }));
}

function treeReducer(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case "RESET":
      return action.nodes;
    case "SET_EXPANDED": {
      const next = cloneNodes(state);
      Tree.nodeFromPath(action.path, next).isExpanded = action.isExpanded;
      return next;
    }
    default:
      return state;
  }
}

export interface JsonTreeViewProps {
  // The already-parsed value (object / array / primitive). Rendering is generic — no schema needed.
  data: unknown;
  className?: string;
}

export function JsonTreeView({ data, className }: JsonTreeViewProps) {
  const [nodes, dispatch] = useReducer(treeReducer, data, (initial) => toTreeNodes(buildJsonTree(initial)));

  // Rebuild (collapsed) only when the underlying data actually changes — not on every render.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    dispatch({ type: "RESET", nodes: toTreeNodes(buildJsonTree(data)) });
  }, [data]);

  const handleExpand = useCallback((_node: TreeNodeInfo, path: NodePath) => {
    dispatch({ type: "SET_EXPANDED", path, isExpanded: true });
  }, []);
  const handleCollapse = useCallback((_node: TreeNodeInfo, path: NodePath) => {
    dispatch({ type: "SET_EXPANDED", path, isExpanded: false });
  }, []);
  const handleClick = useCallback((node: TreeNodeInfo, path: NodePath) => {
    if (node.childNodes) {
      dispatch({ type: "SET_EXPANDED", path, isExpanded: !node.isExpanded });
    }
  }, []);

  return (
    <Tree
      className={`JsonTree ${className ?? ""}`.trim()}
      compact
      contents={nodes}
      onNodeExpand={handleExpand}
      onNodeCollapse={handleCollapse}
      onNodeClick={handleClick}
    />
  );
}

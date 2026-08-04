// The picker behind pi's own `/fork` and `/tree`. Both commands answer with DATA when given no argument — the fork
// points, or the session tree — and act when given an id. Without this the answer had nowhere to go: the command ran,
// the session replied, and the app discarded it.
//
// One drawer for both because they are one question asked two ways: which point in this session do you mean? Picking
// a row sends the id back through the same command the user typed.

import { Button, Callout, Classes, Icon, Intent, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { PiForkPoint, PiSessionTreeNode } from "@/pi-bridge/protocol";
import { AppDrawer } from "@/web-app/components/AppDrawer";

import "./AssistantSessionTreeDrawer.css";

// Which question is being asked. `fork` restarts the conversation from a chosen user message; `tree` moves to a
// chosen branch. pi performs both through `navigateTree`, but they are not the same act to a user.
export type AssistantSessionTreeView =
  | { kind: "fork"; points: readonly PiForkPoint[] }
  | { kind: "tree"; nodes: readonly PiSessionTreeNode[] };

interface AssistantSessionTreeDrawerProps {
  view: AssistantSessionTreeView;
  // Runs pi's command again with the chosen id. Answers with a reason when the session refused, so the drawer can
  // say so instead of closing on a move that never happened.
  onPick: (id: string) => Promise<string | undefined>;
  onClose: () => void;
}

// Only the kinds a picker meets often enough to name. Anything else keeps pi's own word for it, which is more honest
// than "Entry".
const KIND_LABEL: Record<string, string> = {
  message: "Message",
  compaction: "Compacted",
  model_change: "Model changed",
  thinking_level_change: "Reasoning changed",
  branch_summary: "Branch summary",
  label: "Label",
  session_info: "Session",
};

function ForkRow({ point, busy, onPick }: { point: PiForkPoint; busy: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="AssistantSessionTreeRow">
      <Icon icon={IconNames.GIT_BRANCH} size={18} />
      <div className="AssistantSessionTreeBody">
        <div className="AssistantSessionTreeTitle">
          <strong>{point.text || t("(empty message)")}</strong>
        </div>
        <small>{point.entryId}</small>
      </div>
      <Button
        size="small"
        variant="outlined"
        intent={Intent.PRIMARY}
        icon={IconNames.GIT_BRANCH}
        text={t("Fork here")}
        disabled={busy}
        onClick={onPick}
      />
    </div>
  );
}

function TreeRow({
  node,
  depth,
  busy,
  onPick,
}: {
  node: PiSessionTreeNode;
  depth: number;
  busy: boolean;
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="AssistantSessionTreeRow" style={{ paddingLeft: 10 + depth * 18 }}>
        <Icon
          icon={node.current ? IconNames.DOT : IconNames.DIAGRAM_TREE}
          size={18}
          {...(node.current ? { color: "var(--app-accent-text)" } : {})}
        />
        <div className="AssistantSessionTreeBody">
          <div className="AssistantSessionTreeTitle">
            <strong>{node.label || node.preview || t(KIND_LABEL[node.kind] ?? node.kind)}</strong>
            {node.role ? <code>{node.role}</code> : null}
          </div>
          <small>{t(KIND_LABEL[node.kind] ?? node.kind)}</small>
        </div>
        {node.current ? (
          <Tag minimal intent={Intent.SUCCESS}>
            {t("Here")}
          </Tag>
        ) : (
          <Button
            size="small"
            variant="outlined"
            icon={IconNames.FLOW_BRANCH}
            text={t("Switch")}
            disabled={busy}
            onClick={() => onPick(node.id)}
          />
        )}
      </div>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} busy={busy} onPick={onPick} />
      ))}
    </>
  );
}

export function AssistantSessionTreeDrawer({ view, onPick, onClose }: AssistantSessionTreeDrawerProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // A refused move must leave the drawer open and say why: closing on it would look like the branch had changed.
  const pick = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const reason = await onPick(id);
      if (reason) setError(reason);
      else onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fork = view.kind === "fork";
  const count = fork ? view.points.length : view.nodes.length;

  return (
    <AppDrawer
      className="AssistantSessionTreeDrawer"
      icon={fork ? IconNames.GIT_BRANCH : IconNames.DIAGRAM_TREE}
      title={fork ? t("Fork the session") : t("Session tree")}
      size={DrawerSize.SMALL}
      onClose={onClose}
    >
      <div className={Classes.DRAWER_BODY}>
        <div className={Classes.DIALOG_BODY}>
          <div className="AssistantSessionTreeToolbar">
            <span>
              {fork
                ? t(
                    "Start again from one of your earlier messages. The conversation after it is left on its own branch.",
                  )
                : t("Move to another branch of this session. Where you are now is marked.")}
            </span>
            <Tag minimal>{count}</Tag>
          </div>

          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}

          {count === 0 ? (
            <div className="AssistantSessionTreeEmpty">
              {fork ? t("You have not sent a message in this session yet") : t("This session has only one branch")}
            </div>
          ) : (
            <div className="AssistantSessionTreeList">
              {fork
                ? view.points.map((point) => (
                    <ForkRow key={point.entryId} point={point} busy={busy} onPick={() => void pick(point.entryId)} />
                  ))
                : view.nodes.map((node) => (
                    <TreeRow key={node.id} node={node} depth={0} busy={busy} onPick={(id) => void pick(id)} />
                  ))}
            </div>
          )}
        </div>
      </div>
    </AppDrawer>
  );
}

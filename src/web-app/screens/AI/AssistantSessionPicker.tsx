// The Assistant header's ONE session control: what this session is called, and which conversation it is on.
//
// It sits in the header row the screen already has, where the muted container id used to — the id moved into this
// control's own footer, and Workspace / VS Code moved into the "…" overflow, which is what made room for a name. No
// second bar: a new strip would repeat framing the header already provides.
//
// The name renames, the caret lists. One control, two targets, because they are one question to a user: which session
// am I in? Renaming writes BOTH records — pi's own `/name`, so its listing and its export carry it, and the
// connection's configured session, so the launcher row and the next boot read the same name.

import { Button, EditableText, Icon, InputGroup, Intent, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PiSessionSummary } from "@/pi-bridge/protocol";
import { sessionRelativeAge } from "@/web-app/components/ai/sessionHistory";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

import { filterWorkspaceSessions, workspaceSessionTitle } from "./workspaceSessions";

import "./AssistantSessionPicker.css";

export const AssistantSessionPicker: React.FC = () => {
  const { t, i18n } = useTranslation();
  const spec = useCodingAgentStore((state) => state.spec);
  const connectionId = useCodingAgentStore((state) => state.connectionId);
  const sessionName = useCodingAgentStore((state) => state.sessionName);
  const renameSession = useCodingAgentStore((state) => state.renameSession);
  const listWorkspaceSessions = useCodingAgentStore((state) => state.listWorkspaceSessions);
  const resumeWorkspaceSession = useCodingAgentStore((state) => state.resumeWorkspaceSession);
  const newConversation = useCodingAgentStore((state) => state.newConversation);
  // What the user called this connection's session. The header falls back to it whenever pi has not said what it calls
  // the conversation — the name belongs to the session, and a fresh conversation inside it inherits that.
  const configuredName = useAppStore((state) =>
    connectionId ? state.userSettings.ai?.defaultSessions?.[connectionId]?.name : undefined,
  );
  const name = sessionName ?? configuredName ?? "";

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>();
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<PiSessionSummary[]>();
  const [busy, setBusy] = useState(false);

  const relativeTime = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.resolvedLanguage ?? i18n.language, { numeric: "auto", style: "narrow" }),
    [i18n.language, i18n.resolvedLanguage],
  );

  // Asked of the container when the list is opened, never on render: pi reads and parses every session file in the
  // workspace to answer, so this is not something to poll.
  const onToggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setQuery("");
    setBusy(true);
    void listWorkspaceSessions()
      .then(setSessions)
      .catch((error: Error) => {
        setSessions([]);
        Notification.show({ message: error.message, intent: Intent.WARNING });
      })
      .finally(() => setBusy(false));
  }, [listWorkspaceSessions, open]);

  const onRename = useCallback(
    (next: string) => {
      setDraft(undefined);
      if (next.trim() === name) return;
      void renameSession(next).catch((error: Error) =>
        Notification.show({ message: error.message, intent: Intent.WARNING }),
      );
    },
    [name, renameSession],
  );

  // The conversation the container is already on has nothing to resume, so picking it only closes the list.
  const onPick = useCallback(
    (session: PiSessionSummary) => {
      setOpen(false);
      if (session.current) return;
      void resumeWorkspaceSession(session).catch((error: Error) =>
        Notification.show({ message: error.message, intent: Intent.WARNING }),
      );
    },
    [resumeWorkspaceSession],
  );

  const onNew = useCallback(() => {
    setOpen(false);
    void newConversation().catch((error: Error) =>
      Notification.show({ message: error.message, intent: Intent.WARNING }),
    );
  }, [newConversation]);

  const rows = useMemo(() => filterWorkspaceSessions(sessions ?? [], query), [sessions, query]);

  // The rows scroll and everything else stays put: a workspace accumulates conversations, and a popover that grows
  // with them ends up taller than the window it is anchored in.
  const list = (
    <div className="AssistantSessionList">
      <InputGroup
        className="AssistantSessionListSearch"
        size="small"
        leftIcon={IconNames.SEARCH}
        placeholder={t("Search sessions")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Menu size="small" className="AssistantSessionListRows">
        {busy ? <MenuItem disabled text={t("Reading this workspace's sessions…")} /> : null}
        {!busy && rows.length === 0 ? (
          <MenuItem
            disabled
            text={query ? t("No session matches that") : t("This workspace has no other session yet")}
          />
        ) : null}
        {rows.map((session) => {
          const age = sessionRelativeAge(Date.parse(session.modified));
          return (
            <MenuItem
              key={session.path}
              className="AssistantSessionRow"
              icon={session.current ? IconNames.DOT : IconNames.CHAT}
              text={workspaceSessionTitle(session) || t("Untitled session")}
              label={relativeTime.format(age.value, age.unit)}
              active={session.current}
              onClick={() => onPick(session)}
            />
          );
        })}
      </Menu>
      <Menu size="small" className="AssistantSessionListFoot">
        <MenuItem icon={IconNames.PLUS} text={t("New session")} onClick={onNew} />
        {/* The container id lives here now: it identifies the pair for `podman ps`, which is not what a header row is
            for — but it is exactly what someone opening this list to check the session wants. */}
        <li className="AssistantSessionListId">
          <code>{spec?.agentContainerName}</code>
        </li>
      </Menu>
    </div>
  );

  return (
    <div className="AssistantSessionPicker">
      <Icon icon={IconNames.CHAT} size={14} />
      <EditableText
        className="AssistantSessionName"
        value={draft ?? name}
        placeholder={t("Untitled session")}
        selectAllOnFocus
        maxLength={120}
        onChange={setDraft}
        onCancel={() => setDraft(undefined)}
        onConfirm={onRename}
      />
      <PopoverNext
        isOpen={open}
        onInteraction={(next) => {
          if (!next) setOpen(false);
        }}
        usePortal
        placement="bottom-start"
        popoverClassName="AssistantSessionListPopover"
        content={list}
      >
        <Button
          className="AssistantSessionListToggle"
          variant="minimal"
          size="small"
          icon={IconNames.CARET_DOWN}
          title={t("Switch to another session")}
          aria-label={t("Switch to another session")}
          onClick={onToggle}
        />
      </PopoverNext>
    </div>
  );
};

import { Button, ButtonGroup, EditableText, InputGroup, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/ai-system/core/errors";
import { createLogger } from "@/logger";
import {
  moveThreadHistoryHighlight,
  resolveThreadHistoryHighlight,
  selectThreadHistory,
  threadRelativeAge,
} from "@/web-app/components/ai/threadHistory";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { computeSpacers } from "@/web-app/hooks/computeSpacers";
import { useAIStore } from "@/web-app/stores/useAIStore";

const logger = createLogger("web.ai.thread");

export interface ThreadSelectorControl {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
}

export function ThreadSelector({ control }: { control?: ThreadSelectorControl }) {
  const { t, i18n } = useTranslation();
  const threads = useAIStore((state) => state.threads);
  const activeThreadId = useAIStore((state) => state.activeThreadId);
  const newThread = useAIStore((state) => state.newThread);
  const renameThread = useAIStore((state) => state.renameThread);
  const setActiveThread = useAIStore((state) => state.setActiveThread);
  const deleteThread = useAIStore((state) => state.deleteThread);
  const deletingThreads = useAIStore((state) => state.deletingThreads);
  const [localHistoryOpen, setLocalHistoryOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [highlightedThreadId, setHighlightedThreadId] = useState<string>();
  const [listElement, setListElement] = useState<HTMLUListElement | null>(null);
  const listId = useId();
  const historyOpen = control?.open ?? localHistoryOpen;
  const setHistoryOpen = control?.onOpenChange ?? setLocalHistoryOpen;
  const active = threads.find((thread) => thread.id === activeThreadId);
  const filteredThreads = useMemo(() => selectThreadHistory(threads, query), [query, threads]);
  const relativeTime = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.resolvedLanguage ?? i18n.language, { numeric: "auto", style: "narrow" }),
    [i18n.language, i18n.resolvedLanguage],
  );
  const getHistoryScrollElement = useCallback(() => listElement, [listElement]);
  const getThreadKey = useCallback((index: number) => filteredThreads[index].id, [filteredThreads]);
  const historyVirtualizer = useVirtualizer({
    count: filteredThreads.length,
    getScrollElement: getHistoryScrollElement,
    getItemKey: getThreadKey,
    estimateSize: () => 30,
    overscan: 8,
    enabled: historyOpen,
  });
  const effectiveHighlightedThreadId = resolveThreadHistoryHighlight(
    filteredThreads,
    highlightedThreadId,
    activeThreadId,
  );
  const highlightedIndex = filteredThreads.findIndex(({ id }) => id === effectiveHighlightedThreadId);
  const virtualThreads = historyVirtualizer.getVirtualItems();
  const { paddingTop, paddingBottom } = computeSpacers(virtualThreads, historyVirtualizer.getTotalSize(), 0);

  useEffect(() => {
    if (historyOpen) setQuery(control?.query ?? "");
  }, [control?.query, historyOpen]);

  useEffect(() => {
    if (!historyOpen) {
      setHighlightedThreadId(undefined);
      return;
    }
    setHighlightedThreadId((current) => resolveThreadHistoryHighlight(filteredThreads, current, activeThreadId));
  }, [activeThreadId, filteredThreads, historyOpen]);

  useEffect(() => {
    if (!historyOpen || highlightedIndex < 0 || !listElement) return;
    historyVirtualizer.scrollToIndex(highlightedIndex, { align: "auto" });
  }, [highlightedIndex, historyOpen, historyVirtualizer, listElement]);

  const rename = (title: string) => {
    setEditing(false);
    const next = title.trim();
    if (!active || !next || next === active.title) return;
    void renameThread(active.id, next).catch((error) => {
      logger.error("AI: Thread rename failed", { threadId: active.id, error: describeError(error) });
    });
  };

  const remove = (id: string) => {
    void deleteThread(id).catch((error) => {
      logger.error("AI: Thread deletion failed", { threadId: id, error: describeError(error) });
    });
  };

  const create = () => {
    setHistoryOpen(false);
    void newThread().catch((error) => logger.error("AI: Thread creation failed", describeError(error)));
  };

  const chooseThread = (id: string) => {
    setActiveThread(id);
    setHistoryOpen(false);
  };

  const moveHighlight = (delta: number) => {
    setHighlightedThreadId((current) =>
      moveThreadHistoryHighlight(
        filteredThreads,
        resolveThreadHistoryHighlight(filteredThreads, current, activeThreadId),
        delta,
      ),
    );
  };

  const history = (
    <div className="ThreadHistoryPopover">
      <InputGroup
        autoFocus
        size="small"
        leftIcon={IconNames.SEARCH}
        placeholder={t("Search Threads")}
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={historyOpen}
        aria-activedescendant={highlightedIndex >= 0 ? `${listId}-option-${highlightedIndex}` : undefined}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            moveHighlight(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (event.key === "PageDown" || event.key === "PageUp") {
            event.preventDefault();
            event.stopPropagation();
            moveHighlight(event.key === "PageDown" ? 8 : -8);
            return;
          }
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            setHighlightedThreadId(event.key === "Home" ? filteredThreads[0]?.id : filteredThreads.at(-1)?.id);
            return;
          }
          if (event.key === "Enter" && effectiveHighlightedThreadId) {
            event.preventDefault();
            event.stopPropagation();
            chooseThread(effectiveHighlightedThreadId);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setHistoryOpen(false);
          }
        }}
      />
      <Menu
        id={listId}
        ulRef={setListElement}
        size="small"
        className="ThreadHistoryList"
        role="listbox"
        aria-label={t("Thread history")}
        data-windowed="true"
        data-total-count={filteredThreads.length}
      >
        {filteredThreads.length === 0 ? <MenuItem disabled text={t("No Threads found")} /> : null}
        {filteredThreads.length > 0 ? (
          <>
            {paddingTop > 0 ? (
              <li className="ThreadHistorySpacer" role="presentation" style={{ height: paddingTop }} />
            ) : null}
            {virtualThreads.map((item) => {
              const thread = filteredThreads[item.index];
              const age = threadRelativeAge(thread.updatedAt);
              const activeThread = thread.id === activeThreadId;
              const highlighted = thread.id === effectiveHighlightedThreadId;
              return (
                <MenuItem
                  key={item.key}
                  ref={(node) => {
                    if (node) {
                      node.id = `${listId}-option-${item.index}`;
                      node.dataset.index = String(item.index);
                      node.setAttribute("aria-posinset", String(item.index + 1));
                      node.setAttribute("aria-setsize", String(filteredThreads.length));
                    }
                    historyVirtualizer.measureElement(node);
                  }}
                  className={`ThreadHistoryItem${activeThread ? " is-current" : ""}`}
                  roleStructure="listoption"
                  active={highlighted}
                  selected={highlighted}
                  shouldDismissPopover={false}
                  htmlTitle={thread.title}
                  text={<span className="ThreadHistoryTitle">{thread.title}</span>}
                  textClassName="ThreadHistoryItemText"
                  labelElement={
                    <span className="ThreadHistoryItemMeta">
                      <time dateTime={new Date(thread.updatedAt).toISOString()}>
                        {relativeTime.format(age.value, age.unit)}
                      </time>
                      <span className="ThreadHistoryActions">
                        <ConfirmMenu
                          tag={thread.id}
                          title={t("Delete Thread")}
                          disabled={deletingThreads.has(thread.id)}
                          onConfirm={(id, confirmed) => {
                            if (confirmed) remove(String(id));
                          }}
                        />
                      </span>
                    </span>
                  }
                  data-thread-id={thread.id}
                  aria-current={activeThread ? "true" : undefined}
                  tabIndex={-1}
                  onMouseEnter={() => setHighlightedThreadId(thread.id)}
                  onClick={() => chooseThread(thread.id)}
                />
              );
            })}
            {paddingBottom > 0 ? (
              <li className="ThreadHistorySpacer" role="presentation" style={{ height: paddingBottom }} />
            ) : null}
          </>
        ) : null}
      </Menu>
    </div>
  );

  return (
    <div className="ThreadSelector">
      <div className="ThreadSelectorTitle">
        <EditableText
          value={editing ? draft : (active?.title ?? t("New Thread"))}
          disabled={!active}
          isEditing={editing}
          maxLength={256}
          minWidth={120}
          selectAllOnFocus
          customInputAttributes={{ "aria-label": t("Edit") }}
          onEdit={(value) => {
            setDraft(value ?? active?.title ?? "");
            setEditing(true);
          }}
          onChange={setDraft}
          onCancel={() => setEditing(false)}
          onConfirm={rename}
        />
      </div>
      <ButtonGroup minimal>
        <PopoverNext
          isOpen={historyOpen}
          onInteraction={(open) => {
            setHistoryOpen(open);
            if (!open) setQuery("");
          }}
          content={history}
          placement="bottom-end"
          popoverClassName="ThreadHistoryOverlay"
          arrow={false}
          usePortal
          hasBackdrop={false}
        >
          <Button
            icon={IconNames.HISTORY}
            title={t("Thread history")}
            aria-label={t("Thread history")}
            aria-expanded={historyOpen}
          />
        </PopoverNext>
        <Button
          data-action="new-thread"
          icon={IconNames.NEW_COMMENT}
          title={t("New Thread")}
          aria-label={t("New Thread")}
          onClick={create}
        />
      </ButtonGroup>
    </div>
  );
}

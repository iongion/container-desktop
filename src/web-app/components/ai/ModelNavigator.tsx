// Reusable AI inference-source → provider → model drill-down. The SAME navigation is used
// by the chat composer's popover (ModelPicker) and the embedded Settings selector (ProviderSelector), so
// "selecting a model" feels identical no matter the end goal. Built on Blueprint's PanelStack: each step
// is a push/pop slide; the chrome (back · title · combined search + ⟳) is a PERSISTENT bar ABOVE the
// stack. The navigator NEVER persists or closes — it just reports the chosen {providerId, model} via
// onPick; the container owns persistence/close. Discovery state is injected (useModelDiscovery) so its
// cache is shared/survives. PickerContext + all panels live in THIS module so HMR swaps them atomically.
import {
  AnchorButton,
  Button,
  Icon,
  InputGroup,
  Menu,
  MenuItem,
  NonIdealState,
  type Panel,
  type PanelProps,
  PanelStack,
  Spinner,
  SpinnerSize,
} from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_AI_SETTINGS, getProviderEntry } from "@/ai-system/core";
import { buildModelTree, type ModelLeaf } from "@/ai-system/ui/core/modelCatalog";
import type { AISettings } from "@/env/Types";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";

import { ProviderSourceList } from "./ProviderSourceList";
import { type ModelDiscovery, NO_KEY } from "./useModelDiscovery";

export interface ModelPickerValue {
  providerId: string;
  model: string;
}

export interface ModelNavigatorProps {
  value: ModelPickerValue;
  /** Fired when the user picks a model leaf. The container decides side effects (persist / close). */
  onPick: (value: ModelPickerValue) => void;
  /** Injected discovery state machine (cache shared/owned by the container). */
  discovery: ModelDiscovery;
  /** Popover: render a NonIdealState + "Open AI settings" for an unconfigured/unreachable source.
   *  Embedded settings: false → suppress it (the config widget below handles adding a key). */
  showNotConfigured?: boolean;
  /** Cap the auto-sized stack height (px) before it scrolls. Popover ~360; embedded settings larger. */
  maxHeight?: number;
}

export interface ModelNavigatorHandle {
  resetNav: () => void;
}

// Deep-link straight to the AI Assistant settings section (only used by the popover's NonIdealState).
const AI_SETTINGS_HREF = pathTo("/screens/settings/user-settings", undefined, { category: "ai" });

interface PickerContextValue {
  ai: AISettings;
  value: ModelPickerValue;
  modelsBySource: Record<string, string[]>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, string>;
  filter: string;
  showNotConfigured: boolean;
  onPick: (sourceId: string, model: string) => void;
}
const PickerContext = createContext<PickerContextValue | null>(null);
function usePicker(): PickerContextValue {
  const ctx = useContext(PickerContext);
  if (!ctx) {
    throw new Error("ModelNavigator panels must render inside PickerContext");
  }
  return ctx;
}

function matchesFilter(leaf: ModelLeaf, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || leaf.model.toLowerCase().includes(q) || leaf.label.toLowerCase().includes(q);
}

// A clean, actionable empty-state for a source that can't be browsed yet — the Blueprint element designed
// for this, with a shortcut into the AI settings section. Only used when showNotConfigured (the popover).
function NotConfigured({ icon, title, description }: { icon: IconName; title: string; description: string }) {
  const { t } = useTranslation();
  return (
    <NonIdealState
      className="ModelNavigatorNotConfigured"
      icon={<Icon icon={icon} size={28} />}
      title={title}
      description={description}
      action={
        <AnchorButton
          variant="minimal"
          size="small"
          icon={IconNames.COG}
          text={t("Open AI settings")}
          href={AI_SETTINGS_HREF}
        />
      }
    />
  );
}

// Model leaves as MenuItems (listoption → `selected` shows a tick). llama.cpp's single served model is a
// disabled entry tagged with the native `label` slot. Plain helper (no hooks).
function modelItems(sourceId: string, leaves: ModelLeaf[], ctx: PickerContextValue, served: string) {
  return leaves.map((leaf) => (
    <MenuItem
      key={leaf.model}
      roleStructure="listoption"
      text={leaf.label}
      selected={leaf.readOnly ? undefined : leaf.selected}
      disabled={leaf.readOnly}
      shouldDismissPopover={false}
      title={leaf.model}
      label={leaf.readOnly ? served : undefined}
      onClick={leaf.readOnly ? undefined : () => ctx.onPick(sourceId, leaf.model)}
    />
  ));
}

// A non-selectable status row — used inline (embedded) instead of a NonIdealState.
function noticeMenu(text: string) {
  return (
    <Menu size="small">
      <MenuItem disabled text={text} />
    </Menu>
  );
}

// The body of a source panel: spinner / no-key / error notice, OR a menu of either upstream-provider
// drill rows (aggregator) or model leaves (flat / single).
function SourceBody({ sourceId, openPanel }: { sourceId: string; openPanel: PanelProps<object>["openPanel"] }) {
  const { t } = useTranslation();
  const ctx = usePicker();
  const entry = getProviderEntry(sourceId);
  if (!entry) {
    return null;
  }
  if (ctx.loadingBySource[sourceId] && !ctx.modelsBySource[sourceId]) {
    return (
      <div className="ModelNavigatorStatus">
        <Spinner size={SpinnerSize.SMALL} />
        <span>{t("Discovering models…")}</span>
      </div>
    );
  }
  const error = ctx.errorBySource[sourceId];
  if (error === NO_KEY) {
    // Popover: a clean NonIdealState pointing at settings. Embedded: a one-liner — the key field is
    // right below the navigator (so the user is never stuck on the chicken-and-egg).
    return ctx.showNotConfigured ? (
      <NotConfigured
        icon={IconNames.KEY}
        title={t("API key required")}
        description={t("Add an API key for {{name}} in AI settings to discover its models.", { name: entry.label })}
      />
    ) : (
      noticeMenu(t("Add an API key below to load {{name}} models.", { name: entry.label }))
    );
  }
  if (error) {
    // Never surface the raw IPC error — present a clean, actionable state instead.
    return ctx.showNotConfigured ? (
      <NotConfigured
        icon={IconNames.OFFLINE}
        title={t("Unavailable")}
        description={t("Couldn't reach {{name}}. Check its server URL in AI settings.", { name: entry.label })}
      />
    ) : (
      noticeMenu(t("Couldn't reach {{name}} — check its server URL below.", { name: entry.label }))
    );
  }

  const tree = buildModelTree({
    entry,
    models: ctx.modelsBySource[sourceId] ?? [],
    savedModel: ctx.ai.providers?.[sourceId]?.model ?? "",
  });
  if (tree.groups.length === 0) {
    return noticeMenu(tree.notice ?? t("No models available."));
  }

  if (tree.aggregator) {
    const q = ctx.filter.trim().toLowerCase();
    const groups = tree.groups.filter(
      (g) => !q || g.label.toLowerCase().includes(q) || g.models.some((m) => matchesFilter(m, q)),
    );
    return (
      <Menu size="small">
        {groups.length === 0 ? (
          <MenuItem disabled text={t("No matching models.")} />
        ) : (
          groups.map((group) => (
            <MenuItem
              key={group.providerId}
              text={group.label}
              shouldDismissPopover={false}
              labelElement={<Icon icon={IconNames.CHEVRON_RIGHT} />}
              onClick={() =>
                openPanel({
                  title: group.label,
                  props: { sourceId, providerKey: group.providerId },
                  renderPanel: ProviderModelsPanel,
                })
              }
            />
          ))
        )}
      </Menu>
    );
  }

  const leaves = (tree.groups[0]?.models ?? []).filter((m) => matchesFilter(m, ctx.filter));
  return (
    <Menu size="small">
      {leaves.length === 0 ? (
        <MenuItem disabled text={t("No matching models.")} />
      ) : (
        modelItems(sourceId, leaves, ctx, t("served"))
      )}
    </Menu>
  );
}

// Root panel: the shared Local/Cloud provider menu (ProviderSourceList), with a chevron per row and the
// root search wired to its filter. Clicking a source drills into it (openPanel). The SAME list backs the
// Settings configurator — there it selects-to-configure instead of drilling.
function SourcesPanel({ openPanel }: PanelProps<object>) {
  const ctx = usePicker();
  return (
    <div className="ModelNavigatorScroll">
      <ProviderSourceList
        activeId={ctx.value.providerId}
        filter={ctx.filter}
        renderItemRight={() => <Icon icon={IconNames.CHEVRON_RIGHT} />}
        onSelect={(entry) =>
          openPanel({ title: entry.label, props: { sourceId: entry.id }, renderPanel: SourceContentPanel })
        }
      />
    </div>
  );
}

function SourceContentPanel({ sourceId, openPanel }: PanelProps<{ sourceId: string }>) {
  return (
    <div className="ModelNavigatorScroll">
      <SourceBody sourceId={sourceId} openPanel={openPanel} />
    </div>
  );
}

function ProviderModelsPanel({ sourceId, providerKey }: PanelProps<{ sourceId: string; providerKey: string }>) {
  const { t } = useTranslation();
  const ctx = usePicker();
  const entry = getProviderEntry(sourceId);
  const tree = entry
    ? buildModelTree({
        entry,
        models: ctx.modelsBySource[sourceId] ?? [],
        savedModel: ctx.ai.providers?.[sourceId]?.model ?? "",
      })
    : null;
  const group = tree?.groups.find((g) => g.providerId === providerKey);
  const leaves = (group?.models ?? []).filter((m) => matchesFilter(m, ctx.filter));
  return (
    <div className="ModelNavigatorScroll">
      <Menu size="small">
        {leaves.length === 0 ? (
          <MenuItem disabled text={t("No matching models.")} />
        ) : (
          modelItems(sourceId, leaves, ctx, t("served"))
        )}
      </Menu>
    </div>
  );
}

const ROOT_PANEL: Panel<object> = { props: {}, renderPanel: SourcesPanel };

interface PanelStackProps {
  sourceId?: string;
  providerKey?: string;
}

export const ModelNavigator = forwardRef<ModelNavigatorHandle, ModelNavigatorProps>(function ModelNavigator(
  { value, onPick, discovery, showNotConfigured = false, maxHeight = 360 },
  ref,
) {
  const { t } = useTranslation();
  const ai: AISettings = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const { discover, modelsBySource, loadingBySource, errorBySource } = discovery;

  const [filter, setFilter] = useState("");
  const [stack, setStack] = useState<Array<Panel<object>>>([ROOT_PANEL]);
  const rootRef = useRef<HTMLDivElement>(null);

  const pushPanel = useCallback((panel: Panel<object>) => {
    setStack((prev) => [...prev, panel]);
    setFilter("");
  }, []);
  const popPanel = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    setFilter("");
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      resetNav: () => {
        setStack([ROOT_PANEL]);
        setFilter("");
      },
    }),
    [],
  );

  // When a source panel is pushed, kick off that source's discovery (lazy + cached).
  useEffect(() => {
    const top = stack[stack.length - 1]?.props as PanelStackProps | undefined;
    if (top?.sourceId) {
      void discover(top.sourceId);
    }
  }, [stack, discover]);

  // Auto-height: fit the stack to the active panel's content, capped (→ internal scroll) so the popover
  // never wastes space. Measured before paint on every content-affecting change; CSS transitions the
  // height so push/pop still slides. scrollHeight is stable under the cap (no oscillation).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on any content change (deps are the triggers)
  useLayoutEffect(() => {
    const stackEl = rootRef.current?.querySelector(".ModelNavigatorStack") as HTMLElement | null;
    const content = stackEl?.querySelector(".bp6-panel-stack2-view .ModelNavigatorScroll") as HTMLElement | null;
    const h = content?.scrollHeight ?? 0;
    if (stackEl && h > 0) {
      stackEl.style.height = `${Math.min(h, maxHeight)}px`;
    }
  }, [maxHeight, stack, filter, modelsBySource, loadingBySource, errorBySource]);

  const topProps = (stack[stack.length - 1]?.props ?? {}) as PanelStackProps;
  const currentSourceId = topProps.sourceId ?? value.providerId;

  const headerTitle = topProps.providerKey
    ? (getProviderEntry(topProps.providerKey)?.label ?? topProps.providerKey)
    : topProps.sourceId
      ? (getProviderEntry(topProps.sourceId)?.label ?? topProps.sourceId)
      : t("Inference source");

  const ctxValue = useMemo<PickerContextValue>(
    () => ({
      ai,
      value,
      modelsBySource,
      loadingBySource,
      errorBySource,
      filter,
      showNotConfigured,
      onPick: (sourceId, model) => onPick({ providerId: sourceId, model }),
    }),
    [ai, value, modelsBySource, loadingBySource, errorBySource, filter, showNotConfigured, onPick],
  );

  return (
    <div className="ModelNavigator" ref={rootRef}>
      {/* Persistent chrome — outside the sliding stack: back · title · combined search + ⟳ widget. */}
      <div className="ModelNavigatorHeader">
        <div className="ModelNavigatorNav">
          {stack.length > 1 ? (
            <Button
              className="ModelNavigatorBack"
              variant="minimal"
              size="small"
              icon={IconNames.ARROW_LEFT}
              text={t("Back")}
              title={t("Back")}
              aria-label={t("Back")}
              onClick={popPanel}
            />
          ) : null}
          <span className="ModelNavigatorTitle">{headerTitle}</span>
        </div>
        <InputGroup
          className="ModelNavigatorSearch"
          size="small"
          fill
          leftIcon={IconNames.SEARCH}
          value={filter}
          placeholder={t("Search models")}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.currentTarget.value)}
          rightElement={
            <Button
              variant="minimal"
              size="small"
              icon={IconNames.REFRESH}
              title={t("Re-discover models")}
              aria-label={t("Re-discover models")}
              disabled={!!loadingBySource[currentSourceId]}
              onClick={() => void discover(currentSourceId, true)}
            />
          }
        />
      </div>
      <PickerContext.Provider value={ctxValue}>
        <PanelStack
          className="ModelNavigatorStack"
          stack={stack}
          onOpen={pushPanel}
          onClose={popPanel}
          showPanelHeader={false}
          renderActivePanelOnly
        />
      </PickerContext.Provider>
    </div>
  );
});

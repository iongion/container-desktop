// The full-page Assistant surface: a thin wrapper around the shared <AssistantConversation>, which owns the
// transcript (prose, command steps, results, approval cards, tool → generative-UI cards) and the AIComposer.
// The same component backs the summonable quake console, so both surfaces render one continuous session from
// useAIStore. Gated by Metadata.RequiresAI; reached via the header AI menu (ExcludeFromSidebar).
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { AssistantConversation } from "@/web-app/components/ai/AssistantConversation";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import "./AssistantScreen.css";
import i18n from "@/i18n";

export const ID = "ai.assistant";
export const Title = i18n.t("Assistant");

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Focus the composer on mount so the user can type immediately (mirrors the console's focus-on-open).
  useEffect(() => {
    const root = rootRef.current;
    requestAnimationFrame(() => root?.querySelector<HTMLTextAreaElement>(".AIComposerInput")?.focus());
  }, []);
  return (
    <div className="AppScreen" data-screen={ID} ref={rootRef}>
      <AssistantConversation
        composerPlaceholder={t("Message the assistant… (Enter to send, Shift+Enter for newline)")}
      />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/assistant",
};
Screen.Metadata = {
  LeftIcon: IconNames.CHAT,
  RequiresAI: true,
  ExcludeFromSidebar: true, // reached via the header AI menu, not the sidebar
};

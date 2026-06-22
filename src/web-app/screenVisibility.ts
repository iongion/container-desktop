import type { AppScreen } from "@/web-app/Types";

// Sidebar / header-menu visibility. AI is always on, so Metadata.RequiresAI is purely a
// "surface this in the header's AI menu" tag — never an access gate. AI screens stay OUT of the sidebar
// (Metadata.ExcludeFromSidebar) and are reached through the header's AI menu instead. Pure + testable;
// the sidebar (AppSidebar) and the header (AppHeader) consume these.

type ScreenLike = Pick<AppScreen<any>, "Metadata">;

export function visibleSidebarScreens<T extends ScreenLike>(screens: T[]): T[] {
  return screens.filter((screen) => !screen.Metadata?.ExcludeFromSidebar);
}

// The AI screens to surface in the header's AI menu — every RequiresAI screen, regardless of whether it
// is also hidden from the sidebar.
export function aiNavScreens<T extends ScreenLike>(screens: T[]): T[] {
  return screens.filter((screen) => !!screen.Metadata?.RequiresAI);
}

import type { AppScreen } from "@/web-app/Types";

// Sidebar visibility: secondary screens opt out with Metadata.ExcludeFromSidebar and are reached from their
// parent screen instead. Pure + testable; the sidebar (AppSidebar) consumes it.

type ScreenLike = Pick<AppScreen<any>, "Metadata">;

export function visibleSidebarScreens<T extends ScreenLike>(screens: T[]): T[] {
  return screens.filter((screen) => !screen.Metadata?.ExcludeFromSidebar);
}

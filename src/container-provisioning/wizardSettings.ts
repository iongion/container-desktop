import type { WizardSettings } from "./types";

// First-run gate — auto-open the wizard exactly once, on the first launch after install. A LOADED wizard
// object without `firstRunHandledAt` is the "never shown yet" signal; the host writes that marker the moment
// it opens, so it never re-opens on later launches. `wizard === undefined` means settings haven't loaded yet
// (appStore.userSettings starts as `{}`), so we must NOT show — showing there is exactly the every-boot bug.
// `skipAtStartup` is honored only for back-compat so existing opt-out users are never re-shown.
export function shouldShowAtStartup(
  wizard: WizardSettings | undefined,
  isReady: boolean,
  shownThisSession: boolean,
): boolean {
  return (
    isReady && wizard !== undefined && !wizard.firstRunHandledAt && wizard.skipAtStartup !== true && !shownThisSession
  );
}

// Normalize the optional persisted `wizard` blob to a concrete shape (skipAtStartup defaults false),
// mirroring how reconnect / proxy / ai are normalized in Application.getGlobalUserSettings.
export function normalizeWizardSettings(raw?: Partial<WizardSettings>): WizardSettings {
  return { skipAtStartup: false, ...raw };
}

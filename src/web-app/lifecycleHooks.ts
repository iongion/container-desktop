import { Intent } from "@blueprintjs/core";

import { userConfiguration } from "@/container-client/config";
import {
  LIFECYCLE_HOOKS_SETTINGS_KEY,
  normalizeLifecycleHooks,
  setContainerLifecycleHooks,
} from "@/container-client/lifecycleHooks";
import { createLifecycleHookRunner, type LifecycleHookRunner } from "@/platform/lifecycleHookRunner";
import { Notification } from "@/web-app/Notification";

// The app's lifecycle-hook runner: the user's hooks from the settings file, run through the host's Command (so the
// activity log records each run), an after-stop failure shown as a warning. Installed right after the host bridge,
// before the MCP server can take a request, so every start and stop sees it.
let runner: LifecycleHookRunner | undefined;

export function installLifecycleHooks(): LifecycleHookRunner {
  runner ??= createLifecycleHookRunner({
    loadSettings: async () => normalizeLifecycleHooks(await userConfiguration.getKey(LIFECYCLE_HOOKS_SETTINGS_KEY)),
    exec: (program, args, opts) => Command.Execute(program, args, opts),
    warn: (message) => Notification.show({ message, intent: Intent.WARNING }),
  });
  setContainerLifecycleHooks(runner);
  return runner;
}

export function lifecycleHookRunner(): LifecycleHookRunner {
  return runner ?? installLifecycleHooks();
}

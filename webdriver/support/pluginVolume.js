// The engine's ONE plugin volume, and the only place a spec touches it.
//
// `cd-agent-plugins` is per-ENGINE and deliberately outlives every container, image rebuild and session — that is what
// makes a user's `pi install` survive. For a spec it means the opposite: an extension seeded by one spec is loaded by
// EVERY session started afterwards on that engine, and a chatty one keeps the session busy for good.
//
// That is not hypothetical, and it is expensive: a `data-probe.ts` left behind on 2026-08-05 by a run that was killed
// before its `after` hook sent `probe:card` and a `probe:msg` "from a plugin" into every later session. The message is
// conversation input, so the model answered IT — the transcript never went idle, and two unrelated specs failed as "the
// turn never finished" while the container, the bridge, the key and the model were all working. It reads as a defect in
// the app, and it is the environment.
//
// So teardown here never depends on a clean exit: a seeding spec removes its own file BEFORE it writes it as well as
// after, and a spec that needs a quiet session asks `cleanPluginVolumeReason` and skips with the file's name.

import { execFileSync } from "node:child_process";

export const PLUGIN_VOLUME = "cd-agent-plugins";

// Writing to a container volume means writing from inside a container: root plus a chown, because the session mounts it
// as the image's `agent` user (1001).
function inPluginVolume(engine, image, script, extraMounts = []) {
  return execFileSync(
    engine,
    [
      "run",
      "--rm",
      "--user",
      "root",
      "--entrypoint",
      "sh",
      "--volume",
      `${PLUGIN_VOLUME}:/mnt`,
      ...extraMounts,
      image,
      "-c",
      script,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function ensureVolume(engine) {
  try {
    execFileSync(engine, ["volume", "create", PLUGIN_VOLUME], { stdio: "ignore" });
  } catch {
    // Already there — the app reuses one plugin volume by name, which is the whole point of it.
  }
}

// What is installed right now. An absent volume, an absent directory and an engine that cannot answer are all "nothing
// installed": this is asked to DECIDE something, so it must not throw on the ordinary empty case.
export function pluginVolumeExtensions(engine, image) {
  try {
    const listing = inPluginVolume(engine, image, "ls -1 /mnt/extensions 2>/dev/null || true");
    return listing
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function removePluginVolumeExtension(engine, image, fileName) {
  try {
    inPluginVolume(engine, image, `rm -f /mnt/extensions/${fileName}`);
  } catch {
    // Nothing to remove, or no engine to remove it with — either way the file is not there afterwards.
  }
}

// Put a spec's own extension in place. Removes it FIRST: a previous run of this same spec may have been killed before
// its `after`, and a half-written or older copy of the fixture is exactly what this module exists to stop.
export function seedPluginVolumeExtension(engine, image, fileName, hostPath) {
  ensureVolume(engine);
  removePluginVolumeExtension(engine, image, fileName);
  inPluginVolume(
    engine,
    image,
    `mkdir -p /mnt/extensions && cp /seed/${fileName} /mnt/extensions/${fileName} && chown -R 1001:1001 /mnt`,
    ["--volume", `${hostPath}:/seed/${fileName}:ro`],
  );
}

// Pure serializers for podman `registries.conf` (TOML) and docker `daemon.json`. The cardinal rule (review
// correction #1): these are READ-MODIFY-WRITE. The app manages only its OWN entries — every unmanaged user /
// system registry, mirror, search entry, and unknown key MUST survive untouched. Serializing from scratch would
// silently wipe the user's config, so we always parse the existing file first and merge.
//
// TOML parsing/stringifying uses smol-toml (a pure-JS, node-free, TOML 1.0 package) — no native/rust/go TOML, in
// line with the "minimize native surface" goal. The engine writes the serialized text (`cat > file` via stdin).

import { parse, stringify } from "smol-toml";

import type { RegistryTrustEntry } from "@/container-client/types/registry";

export interface PodmanRegistryMirror {
  location: string;
  insecure?: boolean;
}

export interface PodmanRegistry {
  location: string;
  insecure?: boolean;
  blocked?: boolean;
  mirror?: PodmanRegistryMirror[];
  [key: string]: unknown;
}

export interface PodmanRegistriesConf {
  "unqualified-search-registries"?: string[];
  registry?: PodmanRegistry[];
  [key: string]: unknown;
}

// Parse an existing registries.conf. An EMPTY/whitespace file is a valid "no config" → {} (writing managed
// entries onto it is correct — a fresh file). A MALFORMED file THROWS: the orchestration layer catches it and
// ABORTS the write, so a user's hand-edited-but-broken file is never overwritten (correction #1).
export function parsePodmanRegistriesConf(text: string): PodmanRegistriesConf {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return {};
  }
  return parse(trimmed) as PodmanRegistriesConf;
}

export function stringifyPodmanRegistriesConf(conf: PodmanRegistriesConf): string {
  return `${stringify(conf as Record<string, unknown>)}\n`;
}

export function mergeManagedRegistries(
  existing: PodmanRegistriesConf,
  desired: RegistryTrustEntry[],
  removedLocations: string[],
): PodmanRegistriesConf {
  const conf: PodmanRegistriesConf = { ...existing };
  const removed = new Set(removedLocations);

  let registries: PodmanRegistry[] = Array.isArray(conf.registry) ? conf.registry.map((r) => ({ ...r })) : [];
  registries = registries.filter((r) => !removed.has(r.location));

  for (const entry of desired) {
    if (entry.mirrorOf) {
      continue; // mirrors are attached to their target below
    }
    const insecure = entry.tls === "insecure" || entry.tls === "self-signed";
    const idx = registries.findIndex((r) => r.location === entry.name);
    if (insecure) {
      registries[idx >= 0 ? idx : registries.length] = {
        ...(idx >= 0 ? registries[idx] : {}),
        location: entry.name,
        insecure: true,
      };
    } else if (idx >= 0) {
      // Verify TLS: clear the managed insecure flag. If that leaves a bare `{location}` (nothing else), drop it.
      const { insecure: _cleared, ...rest } = registries[idx];
      const keys = Object.keys(rest).filter((k) => k !== "location");
      if (keys.length === 0) {
        registries.splice(idx, 1);
      } else {
        registries[idx] = rest as PodmanRegistry;
      }
    }
  }

  // Mirrors — attach each managed mirror to its target registry's mirror[] (create the target if absent).
  for (const entry of desired) {
    if (!entry.mirrorOf) {
      continue;
    }
    let target = registries.find((r) => r.location === entry.mirrorOf);
    if (!target) {
      target = { location: entry.mirrorOf };
      registries.push(target);
    }
    const mirrors = Array.isArray(target.mirror) ? target.mirror : [];
    if (!mirrors.some((m) => m.location === entry.name)) {
      const mirror: PodmanRegistryMirror = { location: entry.name };
      if (entry.tls === "insecure") {
        mirror.insecure = true;
      }
      target.mirror = [...mirrors, mirror];
    }
  }

  if (registries.length > 0) {
    conf.registry = registries;
  } else {
    delete conf.registry;
  }

  // unqualified-search-registries — keep unmanaged entries, append managed (enabled, non-mirror) by order.
  const managedNames = new Set(desired.map((e) => e.name));
  const managedSearch = desired
    .filter((e) => e.enabled && !e.mirrorOf)
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);
  const existingSearch = Array.isArray(conf["unqualified-search-registries"])
    ? (conf["unqualified-search-registries"] as string[])
    : [];
  const preserved = existingSearch.filter((name) => !removed.has(name) && !managedNames.has(name));
  const merged = [...preserved, ...managedSearch];
  if (merged.length > 0) {
    conf["unqualified-search-registries"] = merged;
  } else {
    delete conf["unqualified-search-registries"];
  }

  return conf;
}

// Docker daemon.json is JSON and already object-merge-friendly. We only set the two keys we manage
// (`insecure-registries`, `registry-mirrors`) and PRESERVE every other daemon setting. Malformed existing JSON
// throws (caller aborts). Docker has no per-registry search-order/mirror, so mirrors collapse to global URLs — a
// documented limitation. Returns the serialized text (2-space, trailing newline).
export function mergeDockerDaemonJson(existingText: string, desired: RegistryTrustEntry[]): string {
  const trimmed = (existingText ?? "").trim();
  const obj: Record<string, unknown> = trimmed ? (JSON.parse(trimmed) as Record<string, unknown>) : {};

  const insecure = desired.filter((e) => e.tls === "insecure" || e.tls === "self-signed").map((e) => e.name);
  const mirrors = desired
    .filter((e) => e.mirrorOf)
    .map((e) => (/^https?:\/\//.test(e.name) ? e.name : `https://${e.name}`));

  if (insecure.length > 0) {
    obj["insecure-registries"] = insecure;
  } else {
    delete obj["insecure-registries"];
  }
  if (mirrors.length > 0) {
    obj["registry-mirrors"] = mirrors;
  } else {
    delete obj["registry-mirrors"];
  }

  return `${JSON.stringify(obj, null, 2)}\n`;
}

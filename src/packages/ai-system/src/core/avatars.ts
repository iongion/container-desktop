// The avatar library — user-uploaded custom faces a worker can wear. OWNED by core: pure data + parse/prepare,
// no I/O. Broker-owned file beside the workers store; the renderer never writes it directly. Mirrors core/workers.

import type { z } from "zod";
import { MAX_AVATAR_FILE_BYTES, MAX_AVATARS } from "./limits";
import { avatarFileSchema, type avatarRecord as avatarRecordSchema } from "./schemas";

export const AVATAR_RECORD_VERSION = 1 as const;

export type AvatarRecord = z.infer<typeof avatarRecordSchema>;

export interface AvatarFileV1 {
  version: typeof AVATAR_RECORD_VERSION;
  avatars: AvatarRecord[];
}

export interface AvatarStoreSnapshot {
  status: "missing" | "ok" | "error";
  avatars: AvatarRecord[];
  path: string;
}

export interface AvatarStore {
  load(): Promise<AvatarStoreSnapshot>;
  save(avatars: AvatarRecord[]): Promise<void>;
}

export function parseAvatarFile(text: string): Pick<AvatarStoreSnapshot, "status" | "avatars"> {
  if (text.length > MAX_AVATAR_FILE_BYTES) return { status: "error", avatars: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "error", avatars: [] };
  }
  const result = avatarFileSchema.safeParse(parsed);
  if (!result.success) return { status: "error", avatars: [] };
  return { status: "ok", avatars: result.data.avatars };
}

export function prepareAvatarFile(avatars: AvatarRecord[]): AvatarFileV1 {
  const retained = [...avatars].sort((left, right) => right.createdAt - left.createdAt).slice(0, MAX_AVATARS);
  const file = { version: AVATAR_RECORD_VERSION, avatars: retained } satisfies AvatarFileV1;
  if (!avatarFileSchema.safeParse(file).success) {
    throw new Error("AI: invalid or oversized avatar record");
  }
  if (JSON.stringify(file).length > MAX_AVATAR_FILE_BYTES) {
    throw new Error("AI: avatar library exceeds its size limit");
  }
  return file;
}

export function upsertAvatar(avatars: AvatarRecord[], avatar: AvatarRecord): AvatarRecord[] {
  const existing = avatars.find((entry) => entry.id === avatar.id);
  if (!existing && avatars.length >= MAX_AVATARS) {
    throw new Error("AI: the avatar library is full");
  }
  return existing ? avatars.map((entry) => (entry.id === avatar.id ? avatar : entry)) : [...avatars, avatar];
}

export function removeAvatar(avatars: AvatarRecord[], id: string): AvatarRecord[] {
  return avatars.filter((entry) => entry.id !== id);
}

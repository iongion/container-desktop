import { type AvatarRecord, type AvatarStore, removeAvatar, upsertAvatar } from "@/ai-system/core/avatars";

// CRUD over the avatar library. Deliberately thin — all the policy lives in core/avatars (validate, cap, upsert
// semantics) and the boundary schema, so this is only the read-modify-write and the in-memory mirror. Mirrors
// workerHost, minus resolveIds (a worker references an avatar by id in its own record, not through a run roster).
export interface AvatarHostDeps {
  store: AvatarStore;
  logger?: { error: (...args: unknown[]) => void };
}

export interface AvatarHost {
  ready(): Promise<void>;
  list(): AvatarRecord[];
  save(avatar: AvatarRecord): Promise<AvatarRecord[]>;
  remove(id: string): Promise<AvatarRecord[]>;
}

export function createAvatarHost(deps: AvatarHostDeps): AvatarHost {
  let avatars: AvatarRecord[] = [];

  const persist = async (next: AvatarRecord[]): Promise<AvatarRecord[]> => {
    await deps.store.save(next);
    avatars = next;
    return avatars;
  };

  return {
    async ready() {
      const snapshot = await deps.store.load();
      avatars = snapshot.avatars;
      if (snapshot.status === "error") {
        deps.logger?.error("AI: avatar library is unreadable", snapshot.path);
      }
    },
    list() {
      return avatars;
    },
    async save(avatar: AvatarRecord) {
      return persist(upsertAvatar(avatars, avatar));
    },
    async remove(id: string) {
      return persist(removeAvatar(avatars, id));
    },
  };
}

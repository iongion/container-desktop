// Co-located TanStack Query layer for the avatar library, over the AI bridge. Like the workers library this is
// NOT a mirrored ResourceDomain: avatars are app-local records owned by the broker's file store. Every mutation
// answers with the FULL library, so the cache is seeded from the response rather than invalidated.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AvatarRecord } from "@/ai-system/core/avatars";

export const avatarKeys = {
  all: ["ai", "avatars"] as const,
  list: () => [...avatarKeys.all, "list"] as const,
};

export const useAvatars = () => {
  return useQuery({
    queryKey: avatarKeys.list(),
    queryFn: async (): Promise<AvatarRecord[]> => (await window.AI.listAvatars()).avatars,
  });
};

export const useSaveAvatar = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (avatar: AvatarRecord) => (await window.AI.saveAvatar(avatar)).avatars,
    onSuccess: (avatars) => {
      qc.setQueryData(avatarKeys.list(), avatars);
    },
  });
};

export const useRemoveAvatar = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await window.AI.removeAvatar(id)).avatars,
    onSuccess: (avatars) => {
      qc.setQueryData(avatarKeys.list(), avatars);
    },
  });
};

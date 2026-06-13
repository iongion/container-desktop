import { useMutation } from "@tanstack/react-query";

import { getActiveHostClient } from "@/container-client/adapters/shared";

export const usePruneSystem = () =>
  useMutation({
    mutationFn: () => getActiveHostClient().pruneSystem(),
  });

export const useResetSystem = () =>
  useMutation({
    mutationFn: () => getActiveHostClient().resetSystem(),
  });

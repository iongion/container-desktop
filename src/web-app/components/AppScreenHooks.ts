import { useState, useCallback } from "react";

export const useAppScreenSearch = (term?: string) => {
  const [searchTerm, setSearchTerm] = useState(term || "");
  const onSearchChange = useCallback(
    (e: any) => {
      const needle = e.currentTarget.value.toLowerCase();
      setSearchTerm(needle);
    },
    [setSearchTerm]
  );
  return { searchTerm, onSearchChange };
};

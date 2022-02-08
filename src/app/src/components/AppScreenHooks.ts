import { useState, useCallback } from "react";

export const useAppScreenSearch = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const onSearchChange = useCallback(
    (e: any) => {
      const needle = e.currentTarget.value.toLowerCase();
      setSearchTerm(needle);
    },
    [setSearchTerm]
  );
  return { searchTerm, onSearchChange };
};

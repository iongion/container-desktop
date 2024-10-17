import { useCallback, useState } from "react";

export const useAppScreenSearch = (term?: string) => {
  const [searchTerm, setSearchTerm] = useState(term || "");
  const onSearchChange = useCallback((e: any) => {
    const needle = e.currentTarget.value.toLowerCase();
    setSearchTerm(needle);
  }, []);
  return { searchTerm, onSearchChange };
};

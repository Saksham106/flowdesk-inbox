"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const SEARCH_NAVIGATION_DEBOUNCE_MS = 1000;

export default function SearchInput({
  defaultValue = "",
  onLocalQueryChange,
}: {
  defaultValue?: string;
  onLocalQueryChange?: (query: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const currentQuery = searchParams.get("q")?.trim() ?? "";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState(defaultValue);
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    setValue(defaultValue);
    setIsNavigating(false);
  }, [defaultValue, searchParamsString]);

  const navigateToQuery = useCallback(
    (q: string) => {
      const params = new URLSearchParams(searchParamsString);
      if (q) {
        params.set("q", q);
      } else {
        params.delete("q");
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [router, pathname, searchParamsString]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setValue(q);
      onLocalQueryChange?.(q);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const trimmed = q.trim();
        setIsNavigating(trimmed !== currentQuery);
        navigateToQuery(trimmed);
      }, SEARCH_NAVIGATION_DEBOUNCE_MS);
    },
    [currentQuery, navigateToQuery, onLocalQueryChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = value.trim();
      setIsNavigating(trimmed !== currentQuery);
      navigateToQuery(trimmed);
    },
    [currentQuery, navigateToQuery, value]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Search by name or phone..."
        aria-busy={isNavigating}
        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 pr-9 text-sm placeholder-slate-400 focus:border-slate-400 focus:outline-none"
      />
      {isNavigating && (
        <span
          className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-slate-200 border-t-slate-500"
          aria-label="Searching"
        />
      )}
    </div>
  );
}
